const micro = require('micro')
const request = require('request-promise')
const listen = require('test-listen')
const handler = require('../index')
const { promisify } = require('util')

const exec = promisify(require('child_process').exec);

describe('mplay-orchestrator', () => {

    let service;
    let url;

    beforeAll(async () => {
        service = micro(handler)
        url = await listen(service)
    })

    afterAll(async () => {
        await request.get({ url: url + '/cleanall' })
        service.close()
    })

    it('can init', async () => {
        jest.setTimeout(30 * 1000)
        const bodyInit = { version: '4.0' }
        const initRes = await request.post({ url: url + '/init', body: bodyInit, json: true })
        const id = initRes.id;
        const {stdout } = await exec(`docker ps | grep ${id}`)
        expect(stdout).toMatch('dbplay/mplay-runner')
        expect(stdout).toMatch('mongo')
    })
})