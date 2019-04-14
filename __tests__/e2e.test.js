const micro = require('micro')
const request = require('request-promise')
const listen = require('test-listen')
const handler = require('../index')

describe('mplay-orchestrator', () => {

    let service;
    let url;

    beforeAll(async () => {
        service = micro(handler)
        url = await listen(service)
    })

    afterAll(async () => {
        await request.get({ url: url + '/clean' })
        service.close()
})

it('can init send command and clean', async () => {
    jest.setTimeout(30 * 1000)
    const bodyInit = { version: '4.0' }
    const initRes = await request.post({ url: url + '/init', body: bodyInit, json: true })
    const id = initRes.id;
    const insertCommand = { id, command: 'db.test.insert({v: 4})'}
    const insertResult = await request.post({ url: url + '/command', body: insertCommand, json: true })
    expect(insertResult).toMatchSnapshot()

    const readCommand = { id, command: 'db.test.find()'}
    const readResult = await request.post({ url: url + '/command', body: readCommand, json: true })
    expect(readResult.status).toEqual('SUCCESS')
    expect(readResult.out).toMatch(/"v" : 4/)
})
})