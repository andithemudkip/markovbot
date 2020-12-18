# MarkovBot v2
**MarkovBot** is a Discord bot that learns from the messages sent in a certain server
## Getting started
```sh
$ npm install
```
Create a `config.json` file with the following structure:
```json
{
    "updateServerFilesInterval": int,
    "replyToBots": bool,
    "token": string
}
```
```sh
$ npm start
```
## Using the bot
* Add the bot to your server
* Create a `markovbot` channel (must be exactly this)
* The bot learns from the messages sent in all channels it has permissions to see
* It will respond to all messages sent in the `markovbot` channel

You can find more info by typing `mk-help` in the `markovbot` channel