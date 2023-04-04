const Discord = require ('discord.js');
const client = new Discord.Client ();
const fs = require ('fs');

const { Task } = require ('@alpha-manager/core');

const MarkovChain = require ('./markov-util.js');

const owoify = require ('owoify-js').default;

const chains = {};
const buffers = {};
// const currentStates = {};


const states = ["FIRST_OR_LAST", "FIRST_WORD/S_ONLY", "FIRST_ONLY", "LAST_ONLY", "RANDOM"];

const config = require ('./config.json');
const { stdout } = require ('process');

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

const servers = fs.readdirSync ('servers');
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
        if (!serverSettings [ch].hasOwnProperty ('owo')) serverSettings [ch].currentState = 1;
        if (!serverSettings [ch].hasOwnProperty ('mentions')) serverSettings [ch].mentions = true;
    }
    if (!fs.existsSync (`./chains/${ch}`)) {
        consoleLog ('from msg file');
        chains [ch] = new MarkovChain ();
        fs.readFileSync (`./servers/${ch}`, 'utf8').split ('\n').forEach (str => {
            chains [ch].update (str);
        });
    } else {
        chains [ch] = new MarkovChain (fs.readFileSync (`./chains/${ch}`, 'utf8'));
    }
    
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
        fs.writeFileSync (`./chains/${servers [i]}`, chains [servers [i]].toString ());
        fs.writeFileSync (`serverSettings.json`, JSON.stringify (serverSettings));
        buffers [servers [i]] = [];
    }
    
    console.timeEnd ('update server files');
}



const onNewMessage = msg => {
    if (msg.guild) {
        let filename = `${msg.guild.id}.txt`;

        if (!servers.includes (filename)) {
            fs.writeFileSync (`./servers/${filename}`, msg.toString () + '\n');
            servers.push (filename);
            initChain (filename);
        } else {
            buffers [filename].push (msg.toString () + '\n');
            chains [filename].update (msg.toString ());
        }
    } else {
        if (msg.toString ().startsWith ('mk-update') && config.admins.includes (msg.author.id)) {
            process.send ({ messageType: 'UPDATE' , ...msg });
        } else {
            msg.reply (`don't dm me`);
        }
    }
}

const replyToMessage = msg => {
    if (chains [`${msg.guild.id}.txt`]) {
        let msgText = textBasedOnState (msg.toString (), serverSettings [`${msg.guild.id}.txt`].currentState);
        let reply = chains [`${msg.guild.id}.txt`].generate ({ from: msgText, grams: 3 });
        if (reply [0] === ' ') reply = reply.substring (1);

        if (!reply || reply == msg.toString ()) {
            reply = chains [`${msg.guild.id}.txt`].generate ({ from: msgText.toLowerCase (), grams: 3 });
        }

        if (reply && reply != msg.toString ()) {
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
            msg.channel.send (reply, { disableMentions: mentions ? 'none' : 'all' });
        } else {
            msg.react ("markov_what:620612190902157343").catch (err => {
                msg.react ("❓");
            });
        }
    }
}

let createAPIMessage = async (interaction, content) => {
    const apiMessage = await Discord.APIMessage.create (client.channels.resolve (interaction.channel_id), content)
        .resolveData ()
        .resolveFiles ()

    return { ...apiMessage.data, files: apiMessage.files };
}

const basicEmbed = () => new Discord.MessageEmbed ()
                            .setColor ("#ff00ff")
                            .setThumbnail ('https://cdn.discordapp.com/avatars/787354572452266024/8fa42be5ca295af674cdcb0c461bb803.png?size=64')
                            .setFooter ("MarkovBot v2.1 by andithemudkip. Original bot by Dazzi.\nSponsored by Hiitchy.");


const helpEmbed = basicEmbed ()
                .setTitle ("MarkovBot v2.1 Help")
                .setDescription ("MarkovBot is a discord bot that uses Markov chains to generate responses to your messages.\nIt learns from the messages sent in the current server (in the channels it has permissions to see), and replies to your messages in the `markovbot` channel;\n Expect it be pretty quiet for a little while after you add it to a server until it learns more words.")
                .addFields ({
                    name: "Commands",
                    value: "`mk-help` - shows this message\n`mk-state [<state>]` - if no state is provided, it displays the possible states; otherwise, sets the chaining state to the one specified\n`mk-lines` - displays the number of lines in the dataset for the current server\n`mk-chain` - generates a random string\n`mk-pin` - replying to a message sent by Markov with `mk-pin` will pin the message in the server's `markovbot-pins` channel (if it exists); alternatively, you can do `mk-pin <message_id>`\n`mk-uwu [<level>]` - if no level is provided it shows the current level and all possible settings; if one is provided it sets the bot's uwu level to the one specified"
                });

const processCommand = msg => {
    let command = msg.toString ().substring (3);
    let commParts = command.split (' ');
    switch (commParts [0]) {
        case 'help':
        msg.channel.send (helpEmbed);
        break;

        case 'state':
        if (commParts.length == 1) {
            msg.channel.send (
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
            )
        } else {
            let s = Number (commParts [1]);
            if (s >= 1 && s <= 5) {
                serverSettings [`${msg.guild.id}.txt`].currentState = states [s - 1];
                msg.channel.send (
                    basicEmbed ()
                        .setTitle ("State set to `" + serverSettings [`${msg.guild.id}.txt`].currentState + "`")
                        .setThumbnail (null)
                )
            } else {
                msg.react ('🚫');
            }
            
        }
        break;

        case 'lines':
        let l = fs.readFileSync (`./servers/${msg.guild.id}.txt`, 'utf8').split ('\n');
        msg.channel.send (
            basicEmbed ()
                .setThumbnail (null)
                .setTitle (`\`${l.length}\` lines found in text file.`)
        )
        break;

        case 'chain':
        let reply = chains [`${msg.guild.id}.txt`].generate ({ grams: 10 });
        msg.channel.send (reply);
        break;

        case 'mentions':
        if (msg.member.hasPermission ('MANAGE_ROLES')) {
            if (commParts.length == 1) {
                msg.channel.send (
                    basicEmbed ()
                        .setTitle ("mentions")
                        .setDescription ("Enable or disable the bot's ability to mention roles or people.")
                        .addFields ({
                            name: "Current setting:",
                            value: serverSettings [`${msg.guild.id}.txt`].mentions ? 1 : 0
                        }, {
                            name: "Available options",
                            value: "0 - OFF\n1 - ON"
                        }, {
                            name: "Changing the setting",
                            value: "Type `mk-mentions <number>` to change the setting"
                        })
                )
            } else {
                let s = Number (commParts [1]);
                if (s === 0 || s === 1) {
                    serverSettings [`${msg.guild.id}.txt`].mentions = [false, true] [Number (commParts [1])];
                    msg.channel.send (
                        basicEmbed ()
                            .setTitle (`set mentions to ${[false, true] [Number (commParts [1])]}`)
                            .setThumbnail (null)
                    )
                } else msg.react ('🚫');
            }
        }
        break;

        case 'pin':
        if (msg.member.hasPermission ('MANAGE_MESSAGES')) {
            let id;
            if (msg.reference) id = msg.reference.messageID;
            else if (commParts.length == 2) id = commParts [1];
            if (id) {
                msg.channel.messages.fetch (id).then (messageToPin => {
                    if (messageToPin.author.id === client.user.id) {
                        let pinChannel = msg.guild.channels.cache.find (ch => ch.name === 'markovbot-pins');
                        if (pinChannel) {
                            let originalText = messageToPin.toString ();
                            let linkToMessage = `https://discordapp.com/channels/${messageToPin.guild.id}/${messageToPin.channel.id}/${id}`;
                            let authorAvatar = `https://cdn.discordapp.com/avatars/${messageToPin.author.id}/${client.user.avatar}.png`;
                            pinChannel.send (
                                basicEmbed ()
                                    .setAuthor (messageToPin.author.username, authorAvatar, linkToMessage)
                                    .setDescription (`${originalText}\n\n[Go to original](${linkToMessage})`)
                                    .setFooter (`Pinned by ${msg.author.username}#${msg.author.discriminator} | #${messageToPin.channel.name} | ${messageToPin.guild.name}`)
                                    .setThumbnail (null)
                            );
                            msg.react ("👌");
                        } else {
                            msg.reply ('there is no `markovbot-pins` channel on this server.');
                        }
                    } else msg.react ('🚫');
                }).catch (err => {
                    msg.react ('🚫');
                });
            } else msg.react ('🚫');
        } else msg.react ('🚫');
        break;

        case 'uwu':
        if (commParts.length == 1) {
            msg.channel.send (
                basicEmbed ()
                    .setTitle ("uwu")
                    .setDescription ("How uwuified should the bot's messages be?")
                    .addFields ({
                        name: "Current uwu level",
                        value: serverSettings [`${msg.guild.id}.txt`].owo
                    }, {
                        name: "Levels",
                        value: "1 - OFF\n2 - LIGHT\n3 - MEDIUM\n4 - HARD\n5 - UVU"
                    }, {
                        name: "Changing the uwu level",
                        value: "Type `mk-uwu <number>` to change the uwu level"
                    })
            )
        } else {
            let s = Number (commParts [1]);
            if (s >= 1 && s <= 5) {
                serverSettings [`${msg.guild.id}.txt`].owo = Number (commParts [1]);
                msg.channel.send (
                    basicEmbed ()
                        .setTitle (`uwu set to ${serverSettings [`${msg.guild.id}.txt`].owo}`)
                        .setThumbnail (null)
                )
            } else msg.react ('🚫');
        }
        break;
    }
}

new Task ()
    .do (updateServerFiles)
    .every (config.updateServerFilesInterval).minute ()
    .start ();

if (!fs.existsSync ('./servers/')) fs.mkdirSync ('./servers/');
if (!fs.existsSync ('./chains/')) fs.mkdirSync ('./chains/');

console.time ('initial init');
// initial init
for (let i = 0; i < servers.length; i++) {
    initChain (servers [i]);
}

console.timeEnd ('initial init');


process.on ('message', msg => {
    switch (msg.messageType) {
        case 'MESSAGE-ADMINS':
        for (let id of config.admins) {
            if (client.users.cache.get (id)) {
                client.users.cache.get (id).send (msg.message);
            }
        }
        break;
    }
});


client.on ('ready', () => {
    consoleLog (`Logged in as ${client.user.tag}!`);
    client.user.setActivity ("you type | mk-help", { type: "WATCHING" });
    process.send ({ messageType: 'READY' });


    // <slash commands>
    client.api.applications (client.user.id).commands.post ({
        data: {
            name: "help",
            description: "Displays the help message for Markovbot"
        }
    }).then (() => consoleLog ('created /help command')).catch (error => consoleLog ('err creating /help command', error));

    client.api.applications (client.user.id).commands.post ({
        data: {
            name: "lines",
            description: "Displays the number of lines in the server's text file"
        }
    }).then (() => consoleLog ('created /lines command')).catch (error => consoleLog ('err creating /lines command', error));


    client.api.applications (client.user.id).commands.post ({
        data: {
            name: "state",
            description: "The MarkovBot chaining state for this server",
            options: [{
                type: 4,
                required: false,
                name: 'state',
                description: 'Set the state to set for this server',
                choices: [
                    { value: 1, name: 'FIRST OR LAST' },
                    { value: 2, name: 'FIRST WORD/S ONLY' },
                    { value: 3, name: 'FIRST ONLY' },
                    { value: 4, name: 'LAST ONLY' },
                    { value: 5, name: 'RANDOM' }
                ]
            }]
        }
    }).then (() => consoleLog ('created /state command')).catch (error => consoleLog ('err creating /state command', error));

    client.api.applications (client.user.id).commands.post ({
        data: {
            name: "uwu",
            description: "The uwu level for MarkovBot's messages in this server",
            options: [{
                type: 4,
                required: false,
                name: 'level',
                description: 'The uwu level',
                choices: [
                    { value: 1, name: 'OFF' },
                    { value: 2, name: 'LIGHT' },
                    { value: 3, name: 'MEDIUM' },
                    { value: 4, name: 'HARD' },
                    { value: 5, name: 'UVU' }
                ]
            }]
        }
    }).then (() => consoleLog ('created /uwu command')).catch (error => consoleLog ('err creating /uwu command', error));

    // client.api.applications (client.user.id).commands.post ({
    //     data: {
    //         name: "mentions",
    //         description: "Enabled or disable the bot's ability to mention roles or people",
    //         options: [{
    //             type: 6,
    //             required: true,
    //             name: 'mentions',
    //             description: 'Allow the bot to mention roles/people?'
    //         }]
    //     }
    // }).then (() => consoleLog ('created /mentions command')).catch (error => consoleLog ('err creating /mentions command', error));

    client.api.applications (client.user.id).commands.post ({
        data: {
            name: "chain",
            description: "Generates a random sentence without a prompt"
        }
    }).then (() => consoleLog ('created /chain command')).catch (error => consoleLog ('err creating /chain command', error));


    // delete command
    // let toDelete = ['790934440846557184', '790937004627066892']
    // client.api.applications (client.user.id).guilds ('205978604826394624').commands ('790932675413671956').delete ().then (console.log).catch (console.error);
    // list commands
    // client.api.applications (client.user.id).commands.get ().then (res => {
    //     // console.log (res);
    //     for (let command of res) {
    //         client.api.applications (client.user.id).commands (command.id).delete ().then (console.log).catch (console.error);
    //     }
    // }).catch (console.error);


    client.ws.on ('INTERACTION_CREATE', async interaction => {
        const command = interaction.data.name.toLowerCase ();
        const args = interaction.data.options;

        let channel = client.channels.cache.find (ch => ch.id === interaction.channel_id);
        if (channel.name === 'markovbot') {
            switch (command) {
                case 'help':
                client.api.interactions (interaction.id, interaction.token).callback.post ({
                    data: {
                        type: 4,
                        data: await createAPIMessage (interaction, helpEmbed)
                    }
                });
                break;
    
                case 'lines':
                let l = fs.readFileSync (`./servers/${interaction.guild_id}.txt`, 'utf8').split ('\n');
                let linesEmbed = basicEmbed ()
                        .setThumbnail (null)
                        .setTitle (`\`${l.length}\` lines found in text file.`);
                client.api.interactions (interaction.id, interaction.token).callback.post ({
                    data: {
                        type: 4,
                        data: await createAPIMessage (interaction, linesEmbed)
                    }
                });
                break;
    
                case 'state':
                let stateResponseEmbed;
                if (args && args.length) {
                    let stateToSet = args.find (arg => arg.name === 'state').value;
                    serverSettings [`${interaction.guild_id}.txt`].currentState = states [stateToSet - 1];
                    stateResponseEmbed = basicEmbed ()
                            .setTitle ("State set to `" + serverSettings [`${interaction.guild_id}.txt`].currentState + "`")
                            .setThumbnail (null);
                } else {
                    stateResponseEmbed = basicEmbed ()
                        .setTitle (`The current state is \`${ serverSettings [`${interaction.guild_id}.txt`].currentState }\``)
                        .setThumbnail (null);
                }
                
                client.api.interactions (interaction.id, interaction.token).callback.post ({
                    data: {
                        type: 4,
                        data: await createAPIMessage (interaction, stateResponseEmbed)
                    }
                });
                break;
    
                case 'uwu':
                let uwuResponseEmbed;
                if (args && args.length) {
                    let uwuLevel = args.find (arg => arg.name === 'level').value;
                    serverSettings [`${interaction.guild_id}.txt`].owo = uwuLevel
                    uwuResponseEmbed = basicEmbed ()
                            .setTitle (`uwu set to ${serverSettings [`${interaction.guild_id}.txt`].owo}`)
                            .setThumbnail (null);
                } else {
                    uwuResponseEmbed = basicEmbed ()
                            .setTitle (`current uwu level: ${serverSettings [`${interaction.guild_id}.txt`].owo}`)
                            .setThumbnail (null);
                }
    
                client.api.interactions (interaction.id, interaction.token).callback.post ({
                    data: {
                        type: 4,
                        data: await createAPIMessage (interaction, uwuResponseEmbed)
                    }
                });
                break;
    
                case 'chain':
                let reply = chains [`${interaction.guild_id}.txt`].generate ({ grams: 10 });
                client.api.interactions (interaction.id, interaction.token).callback.post ({
                    data: {
                        type: 4,
                        data: {
                            content: reply
                        }
                    }
                });
                break;
            }
        } else {
            let user = client.users.cache.get (interaction.member.user.id);
            if (user) {
                user.send ('You cannot use markovbot commands outside of #markovbot 🙁');
            }
        }
    });
    // </slash commands>
});

client.on ('message', msg => {
    if (msg.channel.name === "markovbot" && msg.author.id != client.user.id) {
        if (msg.author.bot && !config.replyToBots || msg.toString ().startsWith ('</')) return;
        if (msg.toString ().startsWith ('mk-')) processCommand (msg);
        else replyToMessage (msg);
    }
    if (msg.author.id != client.user.id) {
        onNewMessage (msg);
    }
});

client.login (config.token);