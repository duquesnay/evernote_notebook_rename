import dotenv from 'dotenv';
import {renameRemainingNotebooks} from "./notebook_utils.ts";
import {EvernoteOAFlow} from "./oauth_flow_utils.ts";


dotenv.config();

const CALLBACK_PORT = 5000
export const CONSUMER_KEY = process.env.CONSUMER_KEY;
export const CONSUMER_SECRET = process.env.CONSUMER_SECRET;

if (!CONSUMER_KEY || !CONSUMER_SECRET) {
    console.error("CONSUMER_KEY or CONSUMER_SECRET not set");
    process.exit(1);
}

const authenticatedClient = await new EvernoteOAFlow(CONSUMER_KEY, CONSUMER_SECRET, CALLBACK_PORT).openAuthenticatedClient()

await renameRemainingNotebooks(authenticatedClient);
