import Evernote from 'evernote';
import http from "http";
import {URL} from "url";
import fs from "fs";
import {TOKEN_FILENAME} from "./config.ts";
import open from "open";


export class EvernoteOAFlow {
    private callbackPort: number;
    private baseClient: Evernote.Client;

    constructor(CONSUMER_KEY: string, CONSUMER_SECRET: string, PORT: number) {
        this.callbackPort = PORT;
        this.baseClient = new Evernote.Client({
            consumerKey: CONSUMER_KEY,
            consumerSecret: CONSUMER_SECRET,
            sandbox: false,
        });
    }

    requestTemporaryToken(callbackUrl) {
        return new Promise<{ tempOAToken: string; tempOASecret: string }>((resolve, reject) => {
            this.baseClient.getRequestToken(callbackUrl, (error, oauthToken, oauthTokenSecret, results) => {
                if (error) {
                    reject(error);
                } else {
                    console.log("temporary token request results: ", results);
                    resolve({tempOAToken: oauthToken, tempOASecret: oauthTokenSecret});
                }
            })
        });
    }

    startVolatileCallbackServer(reject: (reason?: any) => void, resolve: (value: (PromiseLike<string> | string)) => void) {
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
        server.listen(this.callbackPort, () => {
            console.log('Server running at http://localhost:' + this.callbackPort + '/');
        })
        server.on('error', (err) => {
            reject(err);
        })
        return server;
    }

    async requestOAuthVerifier(authorizeUrl): Promise<string> {
        return new Promise((resolve, reject) => {
            this.startVolatileCallbackServer(reject, resolve);
            open(authorizeUrl)
        });
    }

    async flowToOAVerifier(tempOAToken: string) {
        console.log("requesting authorisation url");
        const authorizeUrl = this.baseClient.getAuthorizeUrl(tempOAToken);
        console.log("authorize_url: ", authorizeUrl);
        console.debug('opening browser to retrieve oauth_verifier')
        return this.requestOAuthVerifier(authorizeUrl)
    }

    async flowToAccessToken(callbackUrl) {
        console.debug('requesting temporary token');
        const {tempOAToken, tempOASecret} = await this.requestTemporaryToken(callbackUrl);
        // request user authorisation from temporary token, then retrieve the oauth_verifier in the resulting callback request
        console.debug('requesting oauth verifier');
        const oauthVerifier = <string>await this.flowToOAVerifier(tempOAToken);
        console.debug('requesting access token');
        let accessToken = await this.requestAccessToken(tempOAToken, tempOASecret, oauthVerifier);
        return {accessToken}
    }

    loadStoredAccessToken(): { accessToken: string } {
        if (!fs.existsSync(TOKEN_FILENAME)) {
            return {accessToken: ""};
        }
        const oauthStr = fs.readFileSync(TOKEN_FILENAME, 'utf8');
        const {accessToken} = JSON.parse(oauthStr);
        return {accessToken};
    }


    async refreshAccessToken(callbackUrl) {
        const {accessToken} = await this.flowToAccessToken(callbackUrl);
        fs.writeFileSync(TOKEN_FILENAME, JSON.stringify({
            accessToken
        }));
        return accessToken;
    }

    requestAccessToken(tempOAToken: string, tempOASecret: string, oauthVerifier: string) {
        return new Promise<string>((resolve, reject) => {
            this.baseClient.getAccessToken(
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


    authenticatedClientFromStoredAccessToken() {
        return new Promise<Evernote.Client>(async (resolve, reject) => {
            try {
// 1 get the tokens from the file store
                const {accessToken} = this.loadStoredAccessToken();
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
                if (error.errorCode) {
                    console.error(`${error.constructor.name} error in eventualAuthenticatedClient: ${error.errorCode}, ${error.parameter}`);
                } else {
                    console.error(`Error in eventualAuthenticatedClient: ${Object.keys(error)}`);
                }
                reject(error);
            }

        })
    }


    async pauseUntilRateLimitReset(rateLimitDuration: number) {
        console.debug("rate limit reached " + rateLimitDuration);
        console.log('taking a nap starting at ', new Date().toISOString(), 'until ', new Date(Date.now() + rateLimitDuration).toISOString());

        function delay(seconds: number) {
            return new Promise(resolve => setTimeout(resolve, seconds * 1000));
        }

        await delay(rateLimitDuration);
    }


    async openAuthenticatedClient() {
        return await this.authenticatedClientFromStoredAccessToken().then((client) => {
            return client
        }).catch(async (error) => {
            if (error.errorCode === Evernote.Errors.EDAMErrorCode.RATE_LIMIT_REACHED) {
                await this.pauseUntilRateLimitReset(error.rateLimitDuration);
            } else {
                if (error instanceof NoStoredTokensError) {
                    console.log('No tokens found in the token store');
                } else {
                    console.log('error with existing access token: ', error.message);
                }
                console.debug('retrieving new tokens');
                let callbackUrl = this.generateCallbackUrl(); // your endpoint;
                await this.refreshAccessToken(callbackUrl);
                console.debug('working out new tokens again');
            }
            return await this.authenticatedClientFromStoredAccessToken()
        });
    }

    private generateCallbackUrl() {
        return `http://localhost:${this.callbackPort}/callback`;
    }
}

class NoStoredTokensError extends Error {
    constructor() {
        super("No stored tokens found");
    }
}
