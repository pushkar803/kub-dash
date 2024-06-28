const express = require('express');
const { Client } = require('ssh2');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const upload = multer({ dest: 'pem-files/' });
const { v4: uuidv4 } = require('uuid');
const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const { JsonDB, Config } = require('node-json-db');

var db = new JsonDB(new Config("connections3", true, false, '/'));
var db2 = new JsonDB(new Config("connections4", true, false, '/'));

let sshClients = {};
let activeStreams = {};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/login', upload.single('pemFile'), (req, res) => {

    const { sshString } = req.body;
    const { uuid } = req.body;
    const pemFile = req.file.path;

    console.log("not already connected, so connectiong now 2")
    connectSSH(sshString, fs.readFileSync(pemFile), uuid)
    .then(() => {
        res.status(200).send('SSH Connection Established');
    })
    .catch(err => {
        res.status(500).send(`SSH Connection Error: ${err.message}`);
    });

});

app.get('/list-pods', (req, res) => {
    const sshString = req.query.sshString;
    const sshClient = sshClients[sshString];
    if (!sshClient) {
        return res.status(500).send('Not connected to SSH');
    }

    sshClient.exec('kubectl get pods -n uat', (err, stream) => {
        if (err) return
        if (err) return res.status(500).send(err.message);

        let data = '';
        stream.on('data', (chunk) => {
            data += chunk;
        }).on('close', () => {
            res.status(200).send(data);
        });
    });
});

app.get('/logs/:podName', (req, res) => {
    const { podName } = req.params;
    const sshString = req.query.sshString;
    const sshClient = sshClients[sshString];

    if (!sshClient) {
        return res.status(500).send('Not connected to SSH');
    }

    const streamKey = `logStream-${podName}`;
    sshClient.exec(`kubectl logs -f ${podName} --tail=200 -n uat`, (err, stream) => {
        if (err) return res.status(500).send(err.message);

        activeStreams[streamKey] = stream;

        stream.on('data', (chunk) => {
            io.emit('log', { podName, log: chunk.toString() });
        }).on('close', () => {
            delete activeStreams[streamKey];
        });
    });

    res.status(200).send('Streaming logs...');
});

app.post('/stop-logs', (req, res) => {
    const { podName, sshString } = req.body;
    const streamKey = `logStream-${podName}`;
    if (activeStreams[streamKey]) {
        activeStreams[streamKey].close();
        delete activeStreams[streamKey];
        res.status(200).send(`Stopped logs for pod: ${podName}`);
    } else {
        res.status(404).send(`No active log stream found for pod: ${podName}`);
    }
});

io.on('connection', (socket) => {

    const sessionID = socket.id;
    console.log(sessionID);

    console.log('web socket client connected');
    socket.emit('welcome', { message: 'Welcome to the server!' });

    socket.on('disconnect',async () => {
        const sessionID = socket.id;
        console.log(sessionID);
        console.log('web socket client disconnected');
        try{
            let sshString = await db2.getData("/"+sessionID);
            if (sshString != ""){
                let foundIndex = await db.getIndex("/"+sshString+"/clients", sessionID)
                await db.delete("/"+sshString+"/clients[" + foundIndex + "]");
            }
        } catch(error) {
            console.log(error)
        };
    });

    socket.on('reconnect_ssh', async (data) => {
        console.log('web socket client reconnect req recieved');
        let sshString = data.server
        let uuid = data.uuid
        try{

            await db.push("/"+sshString, {
                clients: [
                    uuid
                ]
            }, false);

            await db2.push("/"+uuid, sshString)

        } catch(error) {
        };
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    loadConnections();
});

function connectSSH(sshString, pemFileData, uuid) {
    return new Promise((resolve, reject) => {
        const [username, host] = sshString.split('@');
        const sshClient = new Client();
        sshClient.on('ready', () => {
            sshClients[sshString] = sshClient;
            saveConnections(sshString, pemFileData, uuid);
            resolve();
        }).on('error', (err) => {
            reject(err);
        }).connect({
            host,
            username,
            privateKey: pemFileData
        });
    });
}

async function saveConnections(sshString, pemFileData, uuid) {
    await db.push("/"+sshString, {
        private_key: pemFileData.toString(),
        clients: [
            uuid
        ]
    }, false);

    await db2.push("/"+uuid, sshString)
}

async function loadConnections() {

    var fdata = await db.getData("/");
    if (fdata != ""){
        for (const [sshString, serverData] of Object.entries(fdata)) {
            if(serverData.clients){
                if (serverData.clients.length > 0){
                    await db.delete("/sshString/clients");
                    connectSSH(sshString, serverData["private_key"]).catch(err => {
                        console.error(`Failed to reconnect to ${sshString}: ${err.message}`);
                    });
                }
            }
        }
    }

}
