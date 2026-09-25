/** Public identifiers of the "Repository Groups" GitHub App (owned by the hash7ff organisation). Not secrets. */
export const GITHUB_APP_CLIENT_ID = "Iv23libmJNxKgFpkRMAF";
/**
 * Numeric app id. Unlike the slug and the display name, this never changes when the app is renamed, so
 * installation matching uses it. The slug is only used to build the installation URL below.
 */
export const GITHUB_APP_ID = 4816822;
export const GITHUB_APP_SLUG = "repository-groups";
/** Display name of the GitHub App, as GitHub shows it on the approval and installation pages. */
export const GITHUB_APP_NAME = "Repository Groups";
export const GITHUB_APP_INSTALL_URL = `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`;
