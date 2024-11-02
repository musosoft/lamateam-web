// auth.config.mjs
import { defineConfig } from 'auth-astro';

export default defineConfig({
  providers: [
    {
      id: 'steam',
      name: 'Steam',
      type: 'oauth',
      version: '2.0',
      authorization: {
        url: 'https://steamcommunity.com/oauth/login',
        params: {
          response_type: 'token',
          client_id: process.env.STEAM_CLIENT_ID,
          state: 'unique_state_value', // Set a unique state value if needed
          mobileminimal: '1',  // Optimizes for embedded browsers
        },
      },
      issuer: 'https://steamcommunity.com', // Placeholder issuer to satisfy auth.js requirements
      token: {
        // Placeholder token URL as Steam does not provide this explicitly
        url: 'https://steamcommunity.com/oauth/token',
      },
      userinfo: {
        async request(context) {
          // Request to get SteamID and related info
          const response = await fetch(`https://api.steampowered.com/ISteamUserOAuth/GetTokenDetails/v1/?access_token=${context.tokens.access_token}`);
          const data = await response.json();

          if (data.response && data.response.steamid) {
            return {
              id: data.response.steamid,
              name: `User ${data.response.steamid}`,
              image: '', // Set image if available from Steam API
            };
          }

          throw new Error("Failed to retrieve Steam user profile");
        },
      },
      clientId: process.env.STEAM_CLIENT_ID,
      clientSecret: process.env.STEAM_CLIENT_SECRET, // Optional, can be omitted if not required by Steam
      callbackUrl: `${process.env.PUBLIC_SITE_URL}/api/auth/callback`,
      profile(profile) {
        return {
          id: profile.id,
          name: profile.name,
          image: profile.image,
        };
      },
    },
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account?.provider === 'steam') {
        token.steam = profile;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.steam) {
        session.user.steam = token.steam;
      }
      return session;
    },
  },
});
