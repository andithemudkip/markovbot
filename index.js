const {
    Client, GatewayIntentBits, Partials, Events, EmbedBuilder, PermissionFlagsBits, ActivityType,
    ApplicationCommandOptionType, InteractionContextType, MessageFlags, GatewayCloseCodes, DiscordjsErrorCodes,
    RESTJSONErrorCodes, OAuth2Scopes
} = require ('discord.js');
const client = new Client ({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    // DM channels aren't cached, so DM messages arrive as partials without this
    partials: [Partials.Channel]
});
const fs = require ('fs');

const MarkovChain = require ('./markov-util.js');

const owoify = require ('owoify-js').default;

const chains = {};
const buffers = {};
// const currentStates = {};


const states = ["FIRST_OR_LAST", "FIRST_WORD/S_ONLY", "FIRST_ONLY", "LAST_ONLY", "RANDOM"];

const config = require ('./config.json');
const { stdout } = require ('process');
const path = require ('path');

// Exit code telling the launcher that restarting won't help until the setup is fixed
const EXIT_CONFIG_ERROR = 78;

// The Discord token comes from DISCORD_TOKEN, set in the environment or in a .env file next to this script
try {
    process.loadEnvFile (path.join (__dirname, '.env'));
} catch (err) {
    if (err.code !== 'ENOENT') throw err;
}
if (!process.env.DISCORD_TOKEN) {
    console.error ('DISCORD_TOKEN is not set. Add it to a .env file in the bot folder (DISCORD_TOKEN=...) or to the environment.');
    process.exit (EXIT_CONFIG_ERROR);
}

let uwu = t => t.replace (/l|r/gi, 'w');

// <utility overrides>
let tmpTimeEnd = console.timeEnd;
console.timeEnd = str => {
    stdout.write (`[${new Date ().toISOString ()}]  `);
    tmpTimeEnd (str);
}

let consoleLog = (...arg) => console.log (`[${new Date ().toISOString ()}] `, ...arg);
// </utility overrides>
let serverSettings = {};

if (fs.existsSync (`serverSettings.json`)) serverSettings = JSON.parse (fs.readFileSync ('serverSettings.json', 'utf8'));

consoleLog (`server settings: `, serverSettings);

if (!fs.existsSync ('./servers/')) fs.mkdirSync ('./servers/');
// One <server id>.txt log per server; skip anything else, like the .DS_Store files macOS creates
const servers = fs.readdirSync ('servers').filter (file => /^\d+\.txt$/.test (file));
consoleLog ('servers: ', `${servers.join (', ')}`);

const initChain = ch => {
    console.time (`initialize chain for server ${ch}`);
    buffers [ch] = [];
    
    if (!serverSettings [ch]) {
        serverSettings [ch] = {
            currentState: states [0],
            owo: 1,
            mentions: true
        }
    } else {
        if (!serverSettings [ch].hasOwnProperty ('currentState')) serverSettings [ch].currentState = states [0];
        if (!serverSettings [ch].hasOwnProperty ('owo')) serverSettings [ch].owo = 1;
        if (!serverSettings [ch].hasOwnProperty ('mentions')) serverSettings [ch].mentions = true;
    }
    chains [ch] = new MarkovChain (fs.readFileSync (`./servers/${ch}`, 'utf8'));
    
    console.timeEnd (`initialize chain for server ${ch}`);
}

const textBasedOnState = (txt, state) => {
    let sent = txt.split (' ');
    let words = [];
    switch (state) {
        case "FIRST_OR_LAST":
        if (Math.floor (Math.random () * 3) + 1 === 3) {
            words.push (sent [sent.length - 1]);
            break;
        }

        case "FIRST_WORD/S_ONLY":
        if (sent.length > 1) {
            let r = Math.floor (Math.random () * 2) + 1;
            for (let i = 0; i < r; i++) {
                words.push (sent [i]);
            }
        } else words.push (sent [0]);
        break;

        case "FIRST_ONLY":
        words.push (sent [0]);
        break;

        case "LAST_ONLY":
        words.push (sent [sent.length - 1]);
        break;

        case "RANDOM":
        words.push (sent [Math.floor (Math.random () * sent.length)]);
        break;
    }

    return words.join (' ');
}

const updateServerFiles = () => {
    console.time ('update server files');
    for (let i = 0; i < servers.length; i++) {
        fs.appendFileSync (`./servers/${servers [i]}`, buffers [servers [i]].join (''));
        fs.writeFileSync (`serverSettings.json`, JSON.stringify (serverSettings));
        buffers [servers [i]] = [];
    }
    
    console.timeEnd ('update server files');
}



const onNewMessage = msg => {
    if (msg.guild) {
        let filename = `${msg.guild.id}.txt`;

        if (!servers.includes (filename)) {
            fs.writeFileSync (`./servers/${filename}`, msg.content + '\n');
            servers.push (filename);
            initChain (filename);
        } else {
            buffers [filename].push (msg.content + '\n');
            chains [filename].update (msg.content);
        }
    } else {
        if (msg.content.startsWith ('mk-update') && config.admins.includes (msg.author.id)) {
            process.send ({
                messageType: 'UPDATE',
                author: { id: msg.author.id },
                attachments: msg.attachments.map (a => ({ url: a.url, name: a.name }))
            });
        } else {
            msg.reply (`don't dm me`).catch (logError ('DM reply'));
        }
    }
}

const replyToMessage = msg => {
    if (chains [`${msg.guild.id}.txt`]) {
        let msgText = textBasedOnState (msg.content, serverSettings [`${msg.guild.id}.txt`].currentState);
        let reply = chains [`${msg.guild.id}.txt`].generate ({ from: msgText });

        if (!reply || reply == msg.content) {
            reply = chains [`${msg.guild.id}.txt`].generate ({ from: msgText });
        }

        if (reply && reply != msg.content) {
            switch (serverSettings [`${msg.guild.id}.txt`].owo) {
                case 2:
                reply = uwu (reply);
                break;

                case 3:
                reply = owoify (reply, 'owo');
                break;

                case 4:
                reply = owoify (reply, 'uwu');
                break;

                case 5:
                reply = owoify (reply, 'uvu');
                break;
            }

            const mentions = serverSettings [`${msg.guild.id}.txt`].mentions;
            msg.channel.send ({ content: reply, allowedMentions: mentions ? undefined : { parse: [] } }).catch (logError ('reply'));
        } else {
            msg.react ("markov_what:620612190902157343").catch (err => {
                msg.react ("❓").catch (logError ('react'));
            });
        }
    }
}

// Log failed Discord requests (e.g. missing permissions) instead of letting them crash the bot
const logError = what => err => consoleLog (`failed to ${what}:`, err.message);

const basicEmbed = () => new EmbedBuilder ()
                            .setColor ("#ff00ff")
                            .setThumbnail ('https://cdn.discordapp.com/avatars/787354572452266024/8fa42be5ca295af674cdcb0c461bb803.png?size=64')
                            .setFooter ({ text: "MarkovBot v2.1 by andithemudkip. Original bot by Dazzi.\nSponsored by Hiitchy." });

// Shown when a server has no chain yet, or it can't produce anything
const NOTHING_TO_SAY = "I don't know enough words in this server yet.";

const generateRandom = guildId => (chains [`${guildId}.txt`] && chains [`${guildId}.txt`].generate ()) || NOTHING_TO_SAY;

const countLines = guildId => {
    const file = `./servers/${guildId}.txt`;
    return fs.existsSync (file) ? fs.readFileSync (file, 'utf8').split ('\n').length : 0;
}


const helpEmbed = basicEmbed ()
                .setTitle ("MarkovBot v2.1 Help")
                .setDescription ("MarkovBot is a discord bot that uses Markov chains to generate responses to your messages.\nIt learns from the messages sent in the current server (in the channels it has permissions to see), and replies to your messages in the `markovbot` channel;\n Expect it be pretty quiet for a little while after you add it to a server until it learns more words.")
                .addFields ({
                    name: "Commands",
                    value: "`mk-help` - shows this message\n`mk-state [<state>]` - if no state is provided, it displays the possible states; otherwise, sets the chaining state to the one specified\n`mk-lines` - displays the number of lines in the dataset for the current server\n`mk-chain` - generates a random string\n`mk-pin` - replying to a message sent by Markov with `mk-pin` will pin the message in the server's `markovbot-pins` channel (if it exists); alternatively, you can do `mk-pin <message_id>`\n`mk-uwu [<level>]` - if no level is provided it shows the current level and all possible settings; if one is provided it sets the bot's uwu level to the one specified"
                });

const processCommand = msg => {
    // Commands need the server's settings, and a member to check permissions on (webhooks have none)
    if (!serverSettings [`${msg.guild.id}.txt`] || !msg.member) return;
    const send = content => msg.channel.send (content).catch (logError (`respond to ${command}`));
    const react = emoji => msg.react (emoji).catch (logError ('react'));
    let command = msg.content.substring (3);
    let commParts = command.split (' ');
    switch (commParts [0]) {
        case 'help':
        send ({ embeds: [helpEmbed] });
        break;

        case 'state':
        if (commParts.length == 1) {
            send ({ embeds: [
                basicEmbed ()
                    .setTitle ("Chaining State")
                    .setDescription ("This setting tells the bot which words of your message it should use to form a sentence.")
                    .addFields ({
                        name: "Current State",
                        value: serverSettings [`${msg.guild.id}.txt`].currentState
                    }, {
                        name: "States",
                        value: "1 - FIRST_OR_LAST\n2 - FIRST_WORD/S_ONLY\n3 - FIRST_ONLY\n4 - LAST_ONLY\n5 - RANDOM"
                    }, {
                        name: "Changing the state",
                        value: "Type `mk-state <number>` to change the state"
                    })
            ] })
        } else {
            let s = Number (commParts [1]);
            if (s >= 1 && s <= 5) {
                serverSettings [`${msg.guild.id}.txt`].currentState = states [s - 1];
                send ({ embeds: [
                    basicEmbed ()
                        .setTitle ("State set to `" + serverSettings [`${msg.guild.id}.txt`].currentState + "`")
                        .setThumbnail (null)
                ] })
            } else {
                react ('🚫');
            }
            
        }
        break;

        case 'lines':
        send ({ embeds: [
            basicEmbed ()
                .setThumbnail (null)
                .setTitle (`\`${countLines (msg.guild.id)}\` lines found in text file.`)
        ] })
        break;

        case 'chain':
        send (generateRandom (msg.guild.id));
        break;

        case 'mentions':
        if (msg.member.permissions.has (PermissionFlagsBits.ManageRoles)) {
            if (commParts.length == 1) {
                send ({ embeds: [
                    basicEmbed ()
                        .setTitle ("mentions")
                        .setDescription ("Enable or disable the bot's ability to mention roles or people.")
                        .addFields ({
                            name: "Current setting:",
                            value: serverSettings [`${msg.guild.id}.txt`].mentions ? '1' : '0'
                        }, {
                            name: "Available options",
                            value: "0 - OFF\n1 - ON"
                        }, {
                            name: "Changing the setting",
                            value: "Type `mk-mentions <number>` to change the setting"
                        })
                ] })
            } else {
                let s = Number (commParts [1]);
                if (s === 0 || s === 1) {
                    serverSettings [`${msg.guild.id}.txt`].mentions = [false, true] [Number (commParts [1])];
                    send ({ embeds: [
                        basicEmbed ()
                            .setTitle (`set mentions to ${[false, true] [Number (commParts [1])]}`)
                            .setThumbnail (null)
                    ] })
                } else react ('🚫');
            }
        }
        break;

        case 'pin':
        if (msg.member.permissions.has (PermissionFlagsBits.ManageMessages)) {
            let id;
            if (msg.reference) id = msg.reference.messageId;
            else if (commParts.length == 2) id = commParts [1];
            if (id) {
                msg.channel.messages.fetch (id).then (messageToPin => {
                    if (messageToPin.author.id === client.user.id) {
                        let pinChannel = msg.guild.channels.cache.find (ch => ch.name === 'markovbot-pins');
                        if (pinChannel) {
                            let originalText = messageToPin.content;
                            let linkToMessage = messageToPin.url;
                            pinChannel.send ({ embeds: [
                                basicEmbed ()
                                    .setAuthor ({ name: messageToPin.author.username, iconURL: client.user.displayAvatarURL (), url: linkToMessage })
                                    .setDescription (`${originalText}\n\n[Go to original](${linkToMessage})`)
                                    .setFooter ({ text: `Pinned by ${msg.author.tag} | #${messageToPin.channel.name} | ${messageToPin.guild.name}` })
                                    .setThumbnail (null)
                            ] }).then (() => react ("👌")).catch (err => {
                                logError ('pin message') (err);
                                react ('🚫');
                            });
                        } else {
                            msg.reply ('there is no `markovbot-pins` channel on this server.').catch (logError ('reply'));
                        }
                    } else react ('🚫');
                }).catch (err => {
                    react ('🚫');
                });
            } else react ('🚫');
        } else react ('🚫');
        break;

        case 'uwu':
        if (commParts.length == 1) {
            send ({ embeds: [
                basicEmbed ()
                    .setTitle ("uwu")
                    .setDescription ("How uwuified should the bot's messages be?")
                    .addFields ({
                        name: "Current uwu level",
                        value: String (serverSettings [`${msg.guild.id}.txt`].owo)
                    }, {
                        name: "Levels",
                        value: "1 - OFF\n2 - LIGHT\n3 - MEDIUM\n4 - HARD\n5 - UVU"
                    }, {
                        name: "Changing the uwu level",
                        value: "Type `mk-uwu <number>` to change the uwu level"
                    })
            ] })
        } else {
            let s = Number (commParts [1]);
            if (s >= 1 && s <= 5) {
                serverSettings [`${msg.guild.id}.txt`].owo = Number (commParts [1]);
                send ({ embeds: [
                    basicEmbed ()
                        .setTitle (`uwu set to ${serverSettings [`${msg.guild.id}.txt`].owo}`)
                        .setThumbnail (null)
                ] })
            } else react ('🚫');
        }
        break;
    }
}

setInterval (updateServerFiles, config.updateServerFilesInterval * 1000);

console.time ('initial init');
// initial init
for (let i = 0; i < servers.length; i++) {
    initChain (servers [i]);
}

console.timeEnd ('initial init');


let shuttingDown = false;
const shutdown = reason => {
    if (shuttingDown) return;
    shuttingDown = true;
    consoleLog (`shutting down (${reason}), saving server files`);
    try {
        updateServerFiles ();
    } catch (err) {
        consoleLog ('error saving server files', err);
    }
    client.destroy ();
    process.exit (0);
}

process.on ('SIGINT', () => shutdown ('SIGINT'));
process.on ('SIGTERM', () => shutdown ('SIGTERM'));
// The launcher went away; exit rather than keep running alongside the next launcher's bot
process.on ('disconnect', () => shutdown ('launcher disconnected'));

process.on ('message', msg => {
    switch (msg.messageType) {
        case 'MESSAGE-ADMINS':
        for (let id of config.admins) {
            client.users.fetch (id)
                .then (user => user.send (msg.message))
                .catch (err => consoleLog (`could not message admin ${id}`, err));
        }
        break;

        case 'SHUTDOWN':
        shutdown ('requested by launcher');
        break;
    }
});


const stateChoices = ['FIRST OR LAST', 'FIRST WORD/S ONLY', 'FIRST ONLY', 'LAST ONLY', 'RANDOM'];
const uwuChoices = ['OFF', 'LIGHT', 'MEDIUM', 'HARD', 'UVU'];
const choicesFrom = names => names.map ((name, i) => ({ name, value: i + 1 }));

// Registered globally on startup; set () replaces the whole list, so removed commands disappear too
const slashCommands = [{
    name: "help",
    description: "Displays the help message for Markovbot"
}, {
    name: "lines",
    description: "Displays the number of lines in the server's text file"
}, {
    name: "state",
    description: "The MarkovBot chaining state for this server",
    options: [{
        type: ApplicationCommandOptionType.Integer,
        required: false,
        name: 'state',
        description: 'Set the state to set for this server',
        choices: choicesFrom (stateChoices)
    }]
}, {
    name: "uwu",
    description: "The uwu level for MarkovBot's messages in this server",
    options: [{
        type: ApplicationCommandOptionType.Integer,
        required: false,
        name: 'level',
        description: 'The uwu level',
        choices: choicesFrom (uwuChoices)
    }]
}, {
    name: "chain",
    description: "Generates a random sentence without a prompt"
}].map (command => ({ ...command, contexts: [InteractionContextType.Guild] }));

client.once (Events.ClientReady, () => {
    consoleLog (`Logged in as ${client.user.tag}!`);
    client.user.setActivity ("you type | mk-help", { type: ActivityType.Watching });
    if (process.send) process.send ({ messageType: 'READY' });

    client.application.commands.set (slashCommands)
        .then (commands => {
            consoleLog (`registered slash commands: ${commands.map (c => '/' + c.name).join (', ')}`);
            return checkCommandAccess ();
        })
        .catch (error => consoleLog ('err registering slash commands', error));
});

// Slash commands only show up in servers where the bot was invited with the applications.commands scope.
// Bots invited before slash commands existed (or with a bot-only link) don't have it there.
const checkCommandAccess = async () => {
    const missing = [];
    for (const guild of client.guilds.cache.values ()) {
        try {
            await guild.commands.fetch ();
        } catch (err) {
            if (err.code === RESTJSONErrorCodes.MissingAccess) missing.push (guild.name);
            else consoleLog (`could not check slash commands in ${guild.name}:`, err.message);
        }
    }

    if (!missing.length) {
        consoleLog (`slash commands are available in all ${client.guilds.cache.size} servers`);
        return;
    }
    const invite = client.generateInvite ({
        scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands],
        permissions: [
            PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AddReactions, PermissionFlagsBits.UseExternalEmojis
        ]
    });
    consoleLog (`slash commands won't show in ${missing.length} of ${client.guilds.cache.size} servers, because the bot wasn't invited with the applications.commands scope there: ${missing.join (', ')}`);
    consoleLog (`to fix it, open this link and pick each of those servers (the bot stays in the server, nothing is reset): ${invite}`);
}

client.on (Events.InteractionCreate, interaction => {
    if (!interaction.isChatInputCommand () || !interaction.guildId) return;

    const respond = content => interaction.reply (content).catch (logError (`respond to /${interaction.commandName}`));

    if (!interaction.channel || interaction.channel.name !== 'markovbot') {
        respond ({ content: 'You cannot use markovbot commands outside of #markovbot 🙁', flags: MessageFlags.Ephemeral });
        return;
    }

    const settings = serverSettings [`${interaction.guildId}.txt`];
    if (!settings && interaction.commandName !== 'help') {
        respond ({ content: NOTHING_TO_SAY, flags: MessageFlags.Ephemeral });
        return;
    }

    switch (interaction.commandName) {
        case 'help':
        respond ({ embeds: [helpEmbed] });
        break;

        case 'lines':
        respond ({ embeds: [
            basicEmbed ()
                .setThumbnail (null)
                .setTitle (`\`${countLines (interaction.guildId)}\` lines found in text file.`)
        ] });
        break;

        case 'state': {
            const stateToSet = interaction.options.getInteger ('state');
            if (stateToSet) settings.currentState = states [stateToSet - 1];
            respond ({ embeds: [
                basicEmbed ()
                    .setTitle (stateToSet ? "State set to `" + settings.currentState + "`" : `The current state is \`${settings.currentState}\``)
                    .setThumbnail (null)
            ] });
            break;
        }

        case 'uwu': {
            const uwuLevel = interaction.options.getInteger ('level');
            if (uwuLevel) settings.owo = uwuLevel;
            respond ({ embeds: [
                basicEmbed ()
                    .setTitle (uwuLevel ? `uwu set to ${settings.owo}` : `current uwu level: ${settings.owo}`)
                    .setThumbnail (null)
            ] });
            break;
        }

        case 'chain':
        respond ({ content: generateRandom (interaction.guildId) });
        break;
    }
});

client.on (Events.MessageCreate, msg => {
    if (msg.channel.name === "markovbot" && msg.author.id != client.user.id) {
        if (msg.author.bot && !config.replyToBots || msg.content.startsWith ('</')) return;
        if (msg.content.startsWith ('mk-')) processCommand (msg);
        else replyToMessage (msg);
    }
    if (msg.author.id != client.user.id) {
        onNewMessage (msg);
    }
});

// Discord closes the connection with these when the token or the bot's settings are wrong; retrying won't help
client.on (Events.ShardDisconnect, ({ code }) => {
    if (code === GatewayCloseCodes.AuthenticationFailed) {
        console.error ('Discord rejected DISCORD_TOKEN as invalid. Check the token in .env or the environment.');
        process.exit (EXIT_CONFIG_ERROR);
    }
    if (code === GatewayCloseCodes.DisallowedIntents) {
        console.error ('Discord refused the Message Content intent. Enable "Message Content Intent" under Bot > Privileged Gateway Intents in the Discord Developer Portal.');
        process.exit (EXIT_CONFIG_ERROR);
    }
});

client.on (Events.Error, err => consoleLog ('client error', err));

client.login (process.env.DISCORD_TOKEN).catch (err => {
    if (err.code === DiscordjsErrorCodes.TokenInvalid) {
        console.error ('Discord rejected DISCORD_TOKEN as invalid. Check the token in .env or the environment.');
        process.exit (EXIT_CONFIG_ERROR);
    }
    consoleLog ('login failed', err);
    process.exit (1);
});
