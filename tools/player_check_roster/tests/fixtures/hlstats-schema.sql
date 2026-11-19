-- Minimal offline schema contract fixture derived from the HLstatsX install schema.
CREATE TABLE IF NOT EXISTS `hlstats_Events_Disconnects` (
  `eventTime` datetime,
  `serverId` int,
  `playerId` int
) ENGINE=MyISAM;

CREATE TABLE IF NOT EXISTS `hlstats_Players` (
  `playerId` int,
  `lastName` varchar(64),
  `game` varchar(32)
) ENGINE=MyISAM;

CREATE TABLE IF NOT EXISTS `hlstats_PlayerUniqueIds` (
  `playerId` int,
  `uniqueId` varchar(64),
  `game` varchar(32)
) ENGINE=MyISAM;
