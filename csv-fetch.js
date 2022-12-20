import FSExtra from 'fs-extra'
import Scramjet from 'scramjet'
import Papaparse from 'papaparse'
import Axios from 'axios'
import AxiosRetry from 'axios-retry'
import AxiosRateLimit from 'axios-rate-limit'
import BetterSqlite3 from 'better-sqlite3'

function stringifyObject(object) {
    if (!object) return ''
    return ' {' + Object.entries(object).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(', ') + '}'
}

function requestor(limit, retries, alert) {
    const timeout = 45 * 1000
    const toErrorMessage = e => {
        if (e.response) return `received code ${e.response.status}` // response recieved, but non-2xx
        if (e.code === 'ECONNABORTED') return `timed out after ${timeout / 1000}ms` // request timed out
        if (e.code) return `received ${e.code}` // request failed, with error code
        return e.message // request not made
    }
    const instance = Axios.create({ timeout })
    AxiosRetry(instance, {
        retries,
        shouldResetTimeout: true,
        retryCondition: e => {
            return !e.response || e.response.status >= 500 || e.response.status === 429 // no response, server error, or hit rate limit
        },
        retryDelay: (number, e) => {
            const message = toErrorMessage(e)
            const attempt = number > 0 && number <= retries && retries > 1 ? ' (retrying' + (number > 1 ? `, attempt ${number}` : '') + '...)' : ''
            if (number === 1) alert({
                destination: e.config.filename,
                message: `${message}${attempt}`,
                source: e.config.url + stringifyObject(e.config.passthrough.headers),
            })
            else alert({
                destination: e.config.filename,
                source: e.config.url + stringifyObject(e.config.passthrough.headers),
                message: `${message}${attempt}`
            })
            return 5 * 1000
        }
    })
    AxiosRateLimit(instance, {
        maxRequests: limit, // so limit is number of requests per second
        perMilliseconds: 1 * 1000
    })
    return (filename, request) => instance({ ...request, filename })
}

async function caching() {
    const databaseExists = await FSExtra.pathExists('.csv-fetch-cache')
    const database = new BetterSqlite3('.csv-fetch-cache')
    if (!databaseExists) {
        database.prepare('create table responses (name)').run()
        database.prepare('create index responses_names on responses (name)').run()
    }
    return {
        getResponse: database.prepare('select name from responses where name = @name'),
        addResponse: database.prepare('insert into responses (name) values (@name)')
    }
}

async function fetcher(urlColumn, nameColumn, depository, suffix, headerlist, limit, retries, checkFile, checkCache, alert) {
    const request = requestor(limit, retries, alert)
    const cache = checkCache ? await caching() : null
    return async row => {
        const name = row.data[nameColumn]
        if (!name) {
            alert({
                source: `Line ${row.line}`,
                message: `name column is empty`,
                importance: 'error'
            })
            return
        }
        const url = row.data[urlColumn]
        if (!url) {
            alert({
                source: `Line ${row.line}`,
                message: `URL column is empty`,
                importance: 'error'
            })
            return
        }
        const headerslist = headerlist ? headerlist.map(headerset => Object.fromEntries(headerset.map(header => header.split(/: ?/)))) : []
        const headers = headerslist ? headerslist[row.line % headerslist.length] : {}
        const filename = name + (suffix || '')
        const existingFile = checkFile ? await FSExtra.pathExists(`${depository}/${filename}`) : false
        const existingCached = checkCache && !existingFile ? await cache.getResponse.get({ name }) : false
        if (checkCache && existingFile && !existingCached) cache.addResponse.run({ name })
        const existing = existingFile || existingCached
        if (existing) {
            alert({
                destination: filename,
                source: url + stringifyObject(headers),
                message: 'exists'
            })
            return true
        }
        try {
            alert({
                destination: filename,
                source: url + stringifyObject(headers),
                message: 'requesting...'
            })
            const response = await request(filename, {
                url,
                headers,
                responseType: 'arraybuffer',
                passthrough: { headers }
            })
            alert({
                destination: filename,
                source: url + stringifyObject(headers),
                message: 'done'
            })
            await FSExtra.writeFile(`${depository}/${filename}`, response.data)
            if (checkCache) cache.addResponse.run({ name })
        }
        catch (e) {
            alert({
                destination: filename,
                source: url + stringifyObject(headers),
                message: e.message.toLowerCase(),
                importance: 'error'
            })
        }
    }
}

function source(filename) {
    const origin = FSExtra.createReadStream(filename).pipe(Papaparse.parse(Papaparse.NODE_STREAM_INPUT, { header: true }))
    let line = 1
    return Scramjet.DataStream.from(origin).map(data => {
        return {
            line: line++,
            data
        }
    })
}

function length(filename) {
    return source(filename).reduce(a => a + 1, 0)
}

async function run(filename, urlColumn, nameColumn, depository, suffix, headers, limit, retries, checkFile, checkCache, alert) {
    await FSExtra.ensureDir(depository)
    const fetch = await fetcher(urlColumn, nameColumn, depository, suffix, headers, limit, retries, checkFile, checkCache, alert)
    return source(filename).each(fetch)
}

export default { run, length }
