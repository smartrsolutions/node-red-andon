'use strict';
/**
 * The view's values from the environment, for a Node-RED that is configured by its
 * container rather than by its editor.
 *
 * Why this sits next to the credentials rather than replacing them: a credential
 * lives in flows_cred.json, which needs a `credentialSecret` and a writable user
 * directory, and it is bound to the node ID that owns it. A container that is
 * handed its secrets as environment variables has none of that - and writing them
 * into the flow instead is the one thing this package will not do. With a prefix
 * set, the flow file carries variable *names* and no secret at all.
 *
 * The names are the ones `andon view create --env-out` writes, so the .env from the
 * configurator can be handed to the container unedited:
 *
 *   ANDON_URL  ANDON_VIEW  ANDON_WRITE_SECRET  ANDON_CONTENT_KEY  ANDON_KEY_VERSION
 *
 * A prefix replaces the leading ANDON_ of each: with ANDON_CLOUD_, the view ID is
 * read from ANDON_CLOUD_VIEW. That is what lets several views share one
 * environment - one prefix per view, as the CLI's --env-prefix does.
 */

// Upper case, ending in an underscore, so that ANDON_CLOUD_ + VIEW reads like a
// variable name. The same pattern the CLI accepts for --env-prefix.
const PREFIX = /^[A-Z][A-Z0-9_]*_$/;

// The five suffixes, without the ANDON_ a prefix stands in for.
const SUFFIXES = ['URL', 'VIEW', 'WRITE_SECRET', 'CONTENT_KEY', 'KEY_VERSION'];

/**
 * name is the variable a suffix is read from. Every message about a missing value
 * has to go through here, otherwise it names a variable nobody set.
 */
function name(prefix, suffix) {
    return String(prefix || 'ANDON_') + suffix;
}

/** pick reads one value, trimmed; the empty string counts as unset. */
function pick(prefix, suffix, env) {
    return String(((env || process.env)[name(prefix, suffix)]) || '').trim();
}

/**
 * checkPrefix throws on a prefix that is not one. An empty prefix is not an error:
 * it means the environment is not consulted at all.
 */
function checkPrefix(prefix) {
    if (!prefix) { return ''; }
    if (!PREFIX.test(prefix)) {
        throw new Error('environment prefix "' + prefix + '" has to be upper case and end in an '
            + 'underscore, for example ANDON_ or ANDON_CLOUD_');
    }
    return prefix;
}

module.exports = { PREFIX, SUFFIXES, name, pick, checkPrefix };
