const fs = require ('fs');
const { fork, exec } = require ('child_process');
const path = require ('path');

const { admins } = require ('./config.json');
const download = require ('download');

let justUpdated = false;

let markov;

let consoleLog = (...arg) => console.log (`[${new Date ().toISOString ()}] `, ...arg);

const messageAdmins = (message, markov) => {
    markov.send ({ messageType: "MESSAGE-ADMINS", message });
}

const handleUpdate = (msg, markov) => {
    if (admins.includes (msg.author.id)) {
        let { attachments } = msg;
        if (attachments.length) {
            if (!fs.existsSync ('./update-temp/')) fs.mkdirSync ('./update-temp/');
            justUpdated = true;
            consoleLog ('updating...');
            messageAdmins ('updating...', markov);
            
            if (attachments.length === 1 && attachments [0].url.endsWith ('.zip')) {
                download (attachments [0].url, './update-temp', { extract: true }).then (res => {
                    for (let file of res) {
                        let fpath = path.join (__dirname, 'update-temp', file.path);
                        let dpath = path.join (__dirname, file.path)
                        consoleLog (`copy ${fpath} to ${dpath}`);
                        try {
                            fs.copyFileSync (fpath, dpath);
                        } catch (error) {
                            consoleLog (err);
                        }
                    }
                    consoleLog ('update finished. checking npm packages. this may take a while.');

                    fs.rmSync ('./update-temp/', { recursive: true });

                    exec (`npm install`, (err, stdout, stderr) => {
                        if (err) {
                            consoleLog (`exec error ${err}`);
                            return;
                        }

                        consoleLog (`output:\n${stdout}`);
                        consoleLog (`stderr: ${stderr}`);

                        consoleLog (`restarting markov.`);

                        restartMarkov ();
                    });
                });
            } else {
                // might add this in the future; for now only zip files are supported
            }
        } else {
            consoleLog ('no files provided');
            messageAdmins ('Received update command; no files provided.', markov);
        }
    }
}

let restartMarkov = () => {
    if (markov) markov.kill ('SIGINT');

    markov = fork (`${__dirname}/index.js`);

    markov.on ('message', msg => {
        switch (msg.messageType) {
            case 'UPDATE':
            handleUpdate (msg, markov);
            break;
    
            case 'READY':
            if (justUpdated) {
                consoleLog ('\nMARKOV HAS BEEN UPDATED\n');
                justUpdated = false;
            }
            break;
        }
    });
}

restartMarkov ();