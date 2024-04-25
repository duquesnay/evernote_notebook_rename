import Evernote from "evernote";
import open from 'open';
import http from "http";
import {URL} from "url";
import fs from "fs";

import {PORT, TOKEN_FILENAME} from "./config.ts";
import dotenv from 'dotenv';
import {renameRemainingNotebooks} from "./notebook_utils.ts";

dotenv.config();

const CONSUMER_KEY = process.env.CONSUMER_KEY;
const CONSUMER_SECRET = process.env.CONSUMER_SECRET;
const CALLBACK_URL = `http://localhost:${PORT}/callback`; // your endpoint

// stop if consumer key or secret are not set
if (!CONSUMER_KEY || !CONSUMER_SECRET) {
    console.error("CONSUMER_KEY or CONSUMER_SECRET not set");
    process.exit(1);
}

const baseClient = new Evernote.Client({
    consumerKey: CONSUMER_KEY,
    consumerSecret: CONSUMER_SECRET,
    sandbox: false,
})

function requestTemporaryToken(callbackUrl) {
    return new Promise<{ tempOAToken: string; tempOASecret: string }>((resolve, reject) => {
        const client = new Evernote.Client({
            consumerKey: CONSUMER_KEY,
            consumerSecret: CONSUMER_SECRET,
            sandbox: false,
        });

        client.getRequestToken(callbackUrl, (error, oauthToken, oauthTokenSecret, results) => {
            if (error) {
                reject(error);
            } else {
                console.log("temporary token request results: ", results);
                resolve({tempOAToken: oauthToken, tempOASecret: oauthTokenSecret});
            }
        })
    });
}

function startVolatileCallbackServer(port, reject: (reason?: any) => void, resolve: (value: (PromiseLike<string> | string)) => void) {
    const server = http.createServer((req, res) => {
            if (!req.url)
                return reject("no url provided")

            const requestUrl = new URL(req.url, `http://${req.headers.host}`)
            const oauthVerifier = requestUrl.searchParams.get('oauth_verifier');
            if (!oauthVerifier) {
                return reject("no oauth_verifier provided")
            }
            res.writeHead(200, {'Content-Type': 'text/html'});
            res.end('<script>window.close();</script>');

            server.close();
            resolve(oauthVerifier);
        }
    )
    server.listen(port, () => {
        console.log('Server running at http://localhost:' + port + '/');
    })
    server.on('error', (err) => {
        reject(err);
    })
    return server;
}


function flowtoOAVerifier(tempOAToken: string) {
    console.log("requesting authorisation url");
    const authorizeUrl = baseClient.getAuthorizeUrl(tempOAToken);
    console.log("authorize_url: ", authorizeUrl);
    console.debug('opening browser to retrieve oauth_verifier')
    return requestOAuthVerifier(authorizeUrl)
}

function requestOAuthVerifier(authorizeUrl): Promise<string> {
    return new Promise((resolve, reject) => {
        startVolatileCallbackServer(5001, reject, resolve);
        open(authorizeUrl)
    });
}

async function flowToAccessToken(callbackUrl) {
    console.debug('requesting temporary token');
    const {tempOAToken, tempOASecret} = await requestTemporaryToken(callbackUrl);
    // request user authorisation from temporary token, then retrieve the oauth_verifier in the resulting callback request
    console.debug('requesting oauth verifier');
    const oauthVerifier = <string>await flowtoOAVerifier(tempOAToken);
    console.debug('requesting access token');
    let accessToken = await requestAccessToken(tempOAToken, tempOASecret, oauthVerifier);
    return {accessToken}
}

// request access token from temporary token and oauth_verifier
// store access token and secret in file

// make it executable

export function loadStoredAccessToken(): { accessToken: string } {
    if (!fs.existsSync(TOKEN_FILENAME)) {
        return {accessToken: ""};
    }
    const oauthStr = fs.readFileSync(TOKEN_FILENAME, 'utf8');
    const {accessToken} = JSON.parse(oauthStr);
    return {accessToken};
}

export async function refreshAccessToken(callbackUrl) {
    const {accessToken} = await flowToAccessToken(callbackUrl);
    fs.writeFileSync(TOKEN_FILENAME, JSON.stringify({
        accessToken
    }));
    return accessToken;
}

function requestAccessToken(tempOAToken: string, tempOASecret: string, oauthVerifier: string) {
    return new Promise<string>((resolve, reject) => {
        baseClient.getAccessToken(
            tempOAToken,
            tempOASecret,
            oauthVerifier,
            (error, oauthToken) => {
                if (error) {
                    reject(error.statusCode);
                } else {
                    resolve(oauthToken)
                }
            })
    });
}

class NoStoredTokensError extends Error {}

async function authenticatedClientFromStoredAccessToken() {
    return new Promise<Evernote.Client>(async (resolve, reject) => {
        try {
// 1 get the tokens from the file store
        const {accessToken} = loadStoredAccessToken();
// 2 if no tokens, error or return
        if (!accessToken) {
            reject(new NoStoredTokensError());
        }
        console.debug('retrieved stored token');

// 3 if tokens, get the access token
        let authenticatedClient = new Evernote.Client({
            token: accessToken,
            sandbox: false,
        });
// 5 if access token, get the user

            console.debug('getting user with new authenticated baseClient')
            const noteStore = authenticatedClient.getNoteStore();
            await noteStore.getSyncState(); // early and cheap checkl
            let user = await authenticatedClient.getUserStore().getUser()
            console.debug("connected to " + user.username)
// 6 if no user, error or return
            resolve(authenticatedClient);
        } catch (error: any) {
            if( error.errorCode ) {
                console.error(`${error.constructor.name} error in eventualAuthenticatedClient: ${error.errorCode}, ${error.parameter}`);
            } else {
                console.error(`Error in eventualAuthenticatedClient: ${Object.keys(error)}`);
            }
            reject(error);
        }

    })
}

async function pauseUntilRateLimitReset(rateLimitDuration: number) {
    console.debug("rate limit reached " + rateLimitDuration);
    console.log('taking a nap starting at ', new Date().toISOString(), 'until ', new Date(Date.now() + rateLimitDuration).toISOString());

    function delay(seconds: number) {
        return new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }

    await delay(rateLimitDuration);
}

async function openAuthenticatedClient() {
    return await authenticatedClientFromStoredAccessToken().then((client) => {
        return client
    }).catch(async (error) => {
        if (error.errorCode === Evernote.Errors.EDAMErrorCode.RATE_LIMIT_REACHED) {
            await pauseUntilRateLimitReset(error.rateLimitDuration);
        } else {
            if (error instanceof NoStoredTokensError) {
                console.log('No tokens found in the token store');
            } else {
                console.log('error with existing access token: ', error.message);
            }
            console.debug('retrieving new tokens');
            await refreshAccessToken(CALLBACK_URL);
            console.debug('working out new tokens again');
        }
        return await authenticatedClientFromStoredAccessToken()
    });
}

const authenticatedClient = await openAuthenticatedClient()

// take all the notebooks, if they are part of a folder, rename the notebook "foldername_notebookname"
// if they are not part of a folder, don't rename the notebook
// if the notebook is already named "foldername_notebookname", don't rename it

await renameRemainingNotebooks(authenticatedClient);
