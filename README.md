# MarkovBot v2
**MarkovBot** is a Discord bot that learns from the messages sent in a certain server
## Getting started
```sh
$ npm install
```
Requires Node.js 20.12 or newer.

Create a `.env` file with your bot token (or set `DISCORD_TOKEN` in the environment):
```sh
DISCORD_TOKEN=your-bot-token
```
Create a `config.json` file with the following structure:
```json
{
    "updateServerFilesInterval": int,
    "replyToBots": bool,
    "admins": [string]
}
```
`updateServerFilesInterval` is in seconds; `admins` are the Discord user IDs allowed to use `mk-update`.
```sh
$ npm start
```
In the [Discord Developer Portal](https://discord.com/developers/applications), enable **Message Content Intent** under *Bot → Privileged Gateway Intents*; the bot can't read messages without it.
## Using the bot
* Add the bot to your server
* Create a `markovbot` channel (must be exactly this)
* The bot learns from the messages sent in all channels it has permissions to see
* It will respond to all messages sent in the `markovbot` channel

You can find more info by typing `mk-help` in the `markovbot` channel