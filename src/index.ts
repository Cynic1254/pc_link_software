import {MastodonDataCollection} from "./Mastodon/DataCollection.js";
import {createClients} from "./Mastodon/AccountHandler.js";
import {join, posix, sep} from "node:path";
import {homedir} from "node:os";
import {Dispatcher} from "./Watcher/Dispatcher.js";
import express from "express"

const VRCHAT_APPID = "438100";
const DEFAULT_WINDOWS_LOG_DIR = join(
    homedir(),
    "AppData",
    "LocalLow",
    "VRChat",
    "VRChat"
).replaceAll(sep, posix.sep);
const DEFAULT_LINUX_LOG_DIR = join(
    homedir(),
    ".steam/steam/steamapps/compatdata",
    VRCHAT_APPID,
    "pfx/drive_c/users/steamuser/AppData/LocalLow/VRChat/VRChat",
).replaceAll(sep, posix.sep);

const logfilePah = process.env.LOGFILE_PATH ?? process.platform === "win32" ? DEFAULT_WINDOWS_LOG_DIR : DEFAULT_LINUX_LOG_DIR;

const dispatcher = new Dispatcher();

const data = new MastodonDataCollection(createClients("https://social.chirpter.com", "./Keys.json", "admin"));

const app = express();

app.get("/api/fetchdata", async (req, res) => {
    console.log("Fetching Data");

    res.status(200).send(JSON.stringify(await data.GetSnapshot()));
    return;
});

app.listen(1254, err => {
    console.log(err);
})

await dispatcher.start(logfilePah);