# MarkovBot v2
**MarkovBot** is a Discord bot that learns from the messages sent in a certain server
## Getting started
Requires Node.js 20.12 or newer. Runs on Windows, macOS and Linux.
```sh
$ npm install
```
In the [Discord Developer Portal](https://discord.com/developers/applications), enable **Message Content Intent** under *Bot → Privileged Gateway Intents*; the bot can't read messages without it.

### Configuration
Each setting can be an environment variable, or a line in a `.env` file next to `index.js` (see `.env.example`). The ones marked with a `config.json` key can also go in a `config.json` file instead; environment variables win.

| Variable | `config.json` key | |
|---|---|---|
| `DISCORD_TOKEN` | | Bot token (required) |
| `ADMINS` | `admins` (array) | Comma-separated Discord user IDs allowed to use `mk-update` |
| `REPLY_TO_BOTS` | `replyToBots` | `true` to also reply to other bots (default `false`) |
| `SAVE_INTERVAL_SECONDS` | `updateServerFilesInterval` | How often new messages and settings are saved (default `60`) |
| `DATA_DIR` | | Folder for the message logs (`servers/`) and `serverSettings.json`; defaults to a Railway volume if one is attached, otherwise the bot's folder |

### Running
```sh
$ npm start
```
This runs the launcher, which restarts the bot if it crashes and handles `mk-update` (admins DM the bot a `.zip` of updated files). `node index.js` runs the bot on its own, for hosts that restart it themselves; `mk-update` is disabled then.

### Hosting on Railway
1. Create a service from this GitHub repo. Railway detects Node and installs from `package-lock.json`.
2. In the service's settings, set the custom start command to `node index.js` (Railway restarts it on failure, and new versions are deployed by pushing to git). `npm start` also works.
3. Attach a **volume** to the service, e.g. mounted at `/data`. Without one, the message logs and settings are lost on every deploy. The bot picks up the volume automatically.
4. Add the variables `DISCORD_TOKEN` and `ADMINS` (and any others from the table above).
5. If the deploy settings let you set a draining time (between Railway's stop signal and a forced kill), give it ~10 seconds, so the bot can save on redeploy. New messages are otherwise saved every `SAVE_INTERVAL_SECONDS`.

To move existing data over, copy `servers/*.txt` to `servers/` on the volume and `serverSettings.json` to the volume's root, while the bot is stopped (otherwise it may overwrite them). Only run one copy of the bot per token: two would both reply to every message.
## Using the bot
* Add the bot to your server
* Create a `markovbot` channel (must be exactly this)
* The bot learns from the messages sent in all channels it has permissions to see
* It will respond to all messages sent in the `markovbot` channel

You can find more info by typing `mk-help` in the `markovbot` channel