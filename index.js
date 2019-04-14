const { json, send } = require('micro')
const { router, get, post } = require('microrouter')
const { promisify } = require('util')
const portfinder = require('portfinder');
const ip = require('ip');
const request = require('request-promise')
const pRetry = require('p-retry');


const { Docker } = require('node-docker-api');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });


const exec = promisify(require('child_process').exec);


function guidGenerator() {
    var S4 = function () {
        return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
    };
    return (S4() + S4() + "-" + S4() + "-" + S4() + "-" + S4() + "-" + S4() + S4() + S4());
}


const init = async (req, res) => {
    const payload = await json(req)
    const version = payload.version;
    const id = guidGenerator();
    const mongoPort = await portfinder.getPortPromise()
    const mongoUrl = 'mongodb://' + ip.address() + ':' + mongoPort
    await exec(`docker run -d --rm --name ${id}mongo -p ${mongoPort}:27017 mongo:${version}`)
    const runnerPort = await portfinder.getPortPromise()
    await exec(`docker run -d -e "MONGODB_URL=mongodb:27017" --name ${id}runner -p ${runnerPort}:3000 --link ${id}mongo:mongodb dbplay/mplay-runner`)
    const database = {
        id,
        mongoUrl,
    };
    send(res, 200, database)
}

async function portOfRunner(id) {
    const containers = await docker.container.list();
    const runner = containers.find(container => {
        return container.data.Names.includes(`/${id}runner`);
    })
    if (!runner) {
        throw new Error('container not found ' + `${id}runner`)
    }
    return runner.data.Ports[0].PublicPort;
}

const sendCommand = async (req, res) => {
    const payload = await json(req)
    const { command, id } = payload;
    const port = await portOfRunner(id);
    const url = 'http://localhost:' + port;
    const body = {
        command,
    }
    const commandOut = await request.post({ url, body, json: true })
    send(res, 200, commandOut)
}

const command = async (req, res) => {
    return pRetry(() => sendCommand(req, res), { retries: 5 })
}

const clean = async (req, res) => {
    await exec(`docker ps | awk '{ print $1,$12 }' | grep -i "\\-............runner" | awk '{print $1}' | xargs -I {} docker stop {}`)
    await exec(`docker ps | awk '{ print $1,$12 }' | grep -i "\\-............mongo" | awk '{print $1}' | xargs -I {} docker stop {}`)
    send(res, 200)
}


const notfound = (req, res) => send(res, 404, 'Not found route')

module.exports = router(
    post('/init', init),
    get('/clean', clean),
    post('/command', command),
    get('/*', notfound))
