import {Dispatcher} from "./Watcher/Dispatcher.js";
import {join, posix, sep} from "node:path";
import {homedir} from "node:os";
import {MastodonSnapshotBuilder} from "./Mastodon/Builder.js";
import {createClient} from "./Mastodon/Client.js";
import express from "express";


const DEFAULT_LOG_DIR = join(
    homedir(),
    "AppData",
    "LocalLow",
    "VRChat",
    "VRChat"
).replaceAll(sep, posix.sep);

const dispatcher = new Dispatcher();

const client = new MastodonSnapshotBuilder(createClient("https://social.chirpter.com", "wJBua2coqDWSMDh5WIamZaA-0DWOShCdIHZmKArbQ_Y"))
const data = await client.build();

const app = express();
app.get("/api/fetchdata", (req, res) => {
    console.log("Request made");

    res.status(200).send(data.snapshot);
    return;
})

app.listen(1254, err => {
    console.log(err);
})

await dispatcher.start(DEFAULT_LOG_DIR);