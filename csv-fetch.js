import FSExtra from 'fs-extra'
import Scramjet from 'scramjet'
import Papaparse from 'papaparse'
import Axios from 'axios'
import AxiosRetry from 'axios-retry'
import AxiosRateLimit from 'axios-rate-limit'

function stringifyObject(object) {
    if (!object) return ''
    return ' [' + Object.entries(object).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(', ') + ']'
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
    return (filename, request) => {
        instance.interceptors.request.use(config => {
            return { ...config, headers: request.headers } // workaround bug where headers disappear on retry
        })
        return instance({ ...request, filename })
    }
}

function fetcher(urlColumn, nameColumn, depository, suffix, headerlist, limit, retries, check, verbose, alert) {
    const request = requestor(limit, retries, alert)
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
        const filename = name + (suffix || '')
        if (check) {
            const exists = await FSExtra.pathExists(`${depository}/${filename}`)
            if (exists && verbose) {
                alert({
                    destination: filename,
                    source: url,
                    message: 'exists'
                })
                return
            }
        }
        const headers = headerlist ? headerlist.map(headerset => Object.fromEntries(headerset.map(header => header.split(/: ?/)))) : []
        const headersRotated = headers ? headers[row.line % headers.length] : {}
        if (verbose) alert({
            destination: filename,
            source: url + stringifyObject(headersRotated),
            message: 'requesting...'
        })
        const response = await request(filename, {
            url,
            headers: headersRotated,
            responseType: 'arraybuffer',
            passthrough: { headers: headersRotated }
        })
        if (verbose) alert({
            destination: filename,
            source: url + stringifyObject(headersRotated),
            message: 'done'
        })
        await FSExtra.writeFile(`${depository}/${filename}`, response.data)
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

async function run(filename, urlColumn, nameColumn, depository, suffix, headers, limit, retries, check, verbose, alert) {
    await FSExtra.ensureDir(depository)
    const fetch = fetcher(urlColumn, nameColumn, depository, suffix, headers, limit, retries, check, verbose, alert)
    return source(filename).each(fetch)
}

export default { run, length }
