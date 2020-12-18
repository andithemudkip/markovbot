const Discord = require ('discord.js');
const client = new Discord.Client ();
const fs = require ('fs');

const { Task } = require ('@alpha-manager/core');

const MarkovChain = require ('./markov-util.js');

const chains = {};
const buffers = {};
const currentStates = {};

const states = ["FIRST_OR_LAST", "FIRST_WORD/S_ONLY", "FIRST_ONLY", "LAST_ONLY", "RANDOM"];

const config = require ('./config.json');
const { stdout } = require ('process');

// <utility overrides>
let tmpTimeEnd = console.timeEnd;
console.timeEnd = str => {
    stdout.write (`[${new Date ().toISOString ()}]  `);
    tmpTimeEnd (str);
}

let consoleLog = (...arg) => console.log (`[${new Date ().toISOString ()}] `, ...arg);
// </utility overrides>

const servers = fs.readdirSync ('servers');
consoleLog ('servers: ', `${servers.join (', ')}`);

const initChain = ch => {
    console.time (`initialize chain for server ${ch}`);
    buffers [ch] = [];
    currentStates [ch] = states [0];
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
        msg.reply (`don't dm me`);
    }
}

const replyToMessage = msg => {
    if (chains [`${msg.guild.id}.txt`]) {
        let msgText = textBasedOnState (msg.toString (), currentStates [`${msg.guild.id}.txt`]);
        let reply = chains [`${msg.guild.id}.txt`].generate ({ from: msgText, grams: 3 });
        if (reply [0] === ' ') reply = reply.substring (1);
        if (reply && reply != msg.toString ()) {
            msg.channel.send (reply);
        } else {
            msg.react ("markov_what:620612190902157343").catch (err => {
                msg.react ("❓");
            });
        }
    }
}

const basicEmbed = () => new Discord.MessageEmbed ()
                            .setColor ("#ff00ff")
                            .setThumbnail ('https://cdn.discordapp.com/avatars/787354572452266024/8fa42be5ca295af674cdcb0c461bb803.png?size=64')
                            .setFooter ("MarkovBot v2 by andithemudkip. Original bot by Dazzi.\nSponsored by Hiitchy.");

const processCommand = msg => {
    let command = msg.toString ().substring (3);
    let commParts = command.split (' ');
    switch (commParts [0]) {
        case 'help':
        msg.channel.send (
            basicEmbed ()
                .setTitle ("MarkovBot v2 Help")
                .setDescription ("MarkovBot is a discord bot that uses Markov chains to generate responses to your messages.\nIt learns from the messages sent in the current server (in the channels it has permissions to see), and replies to your messages in the `markovbot` channel;\n Expect it be pretty quiet for a little while after you add it to a server until it learns more words.")
                .addFields ({
                    name: "Commands",
                    value: "`mk-help` - shows this message\n`mk-state [<state>]` - if no state is provided, it displays the possible states; otherwise, sets the chaining state to the one specified\n`mk-lines` - displays the number of lines in the dataset for the current server\n`mk-chain` - generates a random string"
                })
        );
        break;

        case 'state':
        if (commParts.length == 1) {
            msg.channel.send (
                basicEmbed ()
                    .setTitle ("Chaining State")
                    .setDescription ("This setting tells the bot which words of your message it should use to form a sentence.")
                    .addFields ({
                        name: "Current State",
                        value: currentStates [`${msg.guild.id}.txt`]
                    }, {
                        name: "States",
                        value: "0 - FIRST_OR_LAST\n1 - FIRST_WORD/S_ONLY\n2 - FIRST_ONLY\n3 - LAST_ONLY\n4 - RANDOM"
                    }, {
                        name: "Changing the state",
                        value: "Type `mk-state <number>` to change the state"
                    })
            )
        } else {
            currentStates [`${msg.guild.id}.txt`] = states [Number (commParts [1])];
            msg.channel.send (
                basicEmbed ()
                    .setTitle ("State set to `" + currentStates [`${msg.guild.id}.txt`] + "`")
                    .setThumbnail (null)
            )
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
    }
}

new Task ()
    .do (updateServerFiles)
    .every (config.updateServerFilesInterval).second ()
    .start ();



if (!fs.existsSync ('./servers/')) fs.mkdirSync ('./servers/');
if (!fs.existsSync ('./chains/')) fs.mkdirSync ('./chains/');

console.time ('initial init');
// initial init
for (let i = 0; i < servers.length; i++) {
    initChain (servers [i]);
}

console.timeEnd ('initial init');

client.on ('ready', () => {
    consoleLog (`Logged in as ${client.user.tag}!`);
    client.user.setActivity ("you type | mk-help", { type: "WATCHING" })
});

client.on ('message', msg => {
    if (msg.channel.name === "markovbot" && msg.author.id != client.user.id) {
        if (msg.author.bot && !config.replyToBots) return;
        if (msg.toString ().startsWith ('mk-')) processCommand (msg);
        else replyToMessage (msg);
    }
    if (msg.author.id != client.user.id) {
        onNewMessage (msg);
    }
});

client.login (config.token);