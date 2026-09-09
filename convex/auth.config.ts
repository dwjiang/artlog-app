// A missing or wrong entry here signs every client out silently; keep it in sync with the deployment.
export default {
  providers: [{ domain: process.env.CONVEX_SITE_URL, applicationID: 'convex' }],
};
