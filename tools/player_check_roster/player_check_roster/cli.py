"""Operator-run sequential publisher. Configuration is never echoed."""

import argparse
import logging
import math
import os
import sys
import time

from .steam import canonical
from .transports import HttpPublisher, Rcon
from .worker import MysqlDisconnects, SERVER_ID, build_snapshot

LOG = logging.getLogger(__name__)


def required(name):
    value = os.environ.get(name)
    if not value:
        raise ValueError("Required configuration missing")
    return value


def parse_admin_allowlist(value):
    """Required explicit canonical Steam64 list; NONE means verified no admins."""
    if value == "NONE":
        return frozenset()
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Verified admin allowlist required")
    result = set()
    for entry in value.split(","):
        item = entry.strip()
        if canonical(item)[0] != item or item in result:
            raise ValueError("Admin allowlist must contain unique canonical Steam64 IDs")
        result.add(item)
    return frozenset(result)


def run(once=False):
    # Resolve and validate all config before any network IO. Reload operator's
    # environment by restarting the process after every allowlist change.
    admins = parse_admin_allowlist(required("ADMIN_STEAMID64_ALLOWLIST"))
    if required("HL_EVENT_TIMEZONE") != "UTC":
        raise ValueError("HLstats event timestamps must be verified UTC")
    if required("RCON_HOST") != SERVER_ID.split(":")[0] or int(required("RCON_PORT")) != 27516:
        raise ValueError("RCON target must match the roster server")
    timeout = float(os.environ.get("NETWORK_TIMEOUT", "5"))
    interval = float(os.environ.get("POLL_SECONDS", "30"))
    if not math.isfinite(interval) or not 15 <= interval <= 30:
        raise ValueError("Poll interval must be 15 to 30 seconds")
    rcon = Rcon(required("RCON_HOST"), int(required("RCON_PORT")), required("RCON_PASSWORD"), timeout)
    publisher = HttpPublisher(required("PUBLISHER_URL"), required("CHECK_ROSTER_INGEST_SECRET"), timeout)
    db_config = {"host": required("MYSQL_HOST"), "port": int(os.environ.get("MYSQL_PORT", "3306")),
                 "user": required("MYSQL_USER"), "password": required("MYSQL_PASSWORD"),
                 "database": required("MYSQL_DATABASE")}
    if not 1 <= db_config["port"] <= 65535:
        raise ValueError("Invalid MySQL port")
    import pymysql

    def connect():
        return pymysql.connect(**db_config, charset="utf8mb4", autocommit=True,
                               connect_timeout=max(1, math.ceil(timeout)),
                               read_timeout=timeout, write_timeout=timeout)

    mysql = MysqlDisconnects(connect, required("HL_GAME"), int(required("HL_SERVER_ID")))
    while True:
        # Exceptions terminate the process; no partial snapshots or blind retries.
        publisher.publish(build_snapshot(rcon, mysql, admins))
        LOG.info("Roster accepted")
        if once:
            return
        time.sleep(interval)


def main():
    parser = argparse.ArgumentParser(description="Read-only external roster publisher")
    parser.add_argument("--once", action="store_true", help="Collect and POST once (real IO)")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    os.umask(0o077)
    try:
        run(once=args.once)
    except KeyboardInterrupt:
        return
    except Exception:
        # Exceptions from DB/HTTP may contain credentials, SQL, IPs or payloads.
        # Do not print exception text, traceback, headers or response bodies.
        LOG.error("Publisher stopped; verify configuration and collection sources offline")
        sys.exit(1)


if __name__ == "__main__":
    main()
