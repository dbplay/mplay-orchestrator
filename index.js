const { json, send } = require('micro')
const { router, get, post } = require('microrouter')
const { promisify } = require('util')
const portfinder = require('portfinder');
const ip = require('ip');
const amqp = require('amqplib');

const exec = promisify(require('child_process').exec);

const exchangeName = 'sessionTerminated'
const queueName = 'sessionTerminated'

const DELAY_MS = process.env.NODE_ENV === 'test' ? 5 * 1000 : 5 * 60 * 60 * 1000;

function guidGenerator() {
    var S4 = function () {
        return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
    };
    return (S4() + S4() + "-" + S4() + "-" + S4() + "-" + S4() + "-" + S4() + S4() + S4());
}


const init = async (req, res) => {
    const connection = await amqp.connect(process.env.AMQP_URL || 'amqp://localhost');
    try {
        const id = guidGenerator();
        // TODO optimise it to recycle channel across calls
        const channel = await connection.createChannel();
        if (!channel) {
            throw new Error('Channel not initialized')
        }
        await channel.assertExchange(exchangeName, "x-delayed-message", { durable: false, arguments: { 'x-delayed-type': "direct" } })

        const queue = await channel.assertQueue(queueName + '-' + id, {
            exclusive: true,
        });
        await channel.bindQueue(queue.queue, exchangeName, id);
        const message = {
            id,
        }
        await channel.consume(queue.queue, async (messageBuffer) => {
            try {
                const message = JSON.parse(messageBuffer.content.toString())

                console.log(message)
                const { id } = message;
                try {
                    console.log(`stopping ${id}mongo`)
                    await exec(`docker rm -f ${id}mongo`)
                } catch(error) {
                    console.warn(error)
                }
                try {
                    console.log(`stopping ${id}runner`)
                    await exec(`docker rm -f ${id}runner`)
                } catch(error) {
                    console.warn(error)
                }
                console.log('dockers stopped for ' + id)
            } catch (error) {
                console.error(error);
            } finally {
                connection.close()
            }
        }, { noAck: false });

        channel.publish(exchangeName, id, Buffer.from(JSON.stringify(message)), { headers: { "x-delay": DELAY_MS } })
        const payload = await json(req)
        const version = payload.version;
        const mongoPort = await portfinder.getPortPromise()
        const mongoUrl = 'mongodb://' + ip.address() + ':' + mongoPort
        await exec(`docker run -d --rm --name ${id}mongo -p ${mongoPort}:27017 mongo:${version}`)
        const runnerPort = await portfinder.getPortPromise()
        await exec(`docker run -d --rm -e "AMQP_URL=${process.env.AMQP_URL}"    -e "RUNNER_ID=${id}" -e "MONGODB_URL=mongodb:27017" --name ${id}runner -p ${runnerPort}:3000 --link ${id}mongo:mongodb dbplay/mplay-runner`)
        const database = {
            id,
            mongoUrl,
        };
        send(res, 200, database)
    } catch (error) {
        connection.close()
        throw error;
    }
}

const cleanall = async (req, res) => {
    await exec(`docker ps | awk '{ print $1,$11 }' | grep -i "\\-............runner" | awk '{print $1}' | xargs -I {} docker stop {}`)
    await exec(`docker ps | awk '{ print $1,$11 }' | grep -i "\\-............mongo" | awk '{print $1}' | xargs -I {} docker stop {}`)
    send(res, 200)
}


const notfound = (req, res) => send(res, 404, 'Not found route')

module.exports = router(
    post('/init', init),
    get('/cleanall', cleanall),
    get('/*', notfound))
