import FSExtra from 'fs-extra'
import Scramjet from 'scramjet'
import Axios from 'axios'
import AxiosRetry from 'axios-retry'
import AxiosRateLimit from 'axios-rate-limit'

function fetcher(urlColumn, nameColumn, depository, suffix, headers, limit, retries, check, verbose, alert) {
    const timeout = 45 * 1000
    const toErrorMessage = e => {
        const locationName = e.config.url
        if (e.response) return `Received code ${e.response.status}: ${locationName}` // response recieved, but non-2xx
        if (e.code === 'ECONNABORTED') return `Timed out after ${timeout / 1000}ms: ${locationName}` // request timed out
        if (e.code) return `Error ${e.code}: ${locationName}` // request failed, with error code
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
            if (number === 1) alert(`${message}${attempt}`)
            else alert(`  → ${message}${attempt}`)
            return 5 * 1000
        }
    })
    AxiosRateLimit(instance, {
        maxRequests: limit, // so limit is number of requests per second
        perMilliseconds: 1 * 1000
    })
    const stringifyObject = object => Object.entries(object).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(' ')
    return async row => {
        const name = row.data[nameColumn]
        if (!name) {
            alert(`Error on row ${row.line}: Name column is empty!`)
            return
        }
        const url = row.data[urlColumn]
        if (!url) {
            alert(`Error on row ${row.line}: URL column is empty!`)
            return
        }
        const filename = name + (suffix || '')
        if (check) {
            const exists = await FSExtra.pathExists(`${depository}/${filename}`)
            if (exists && verbose) {
                alert(`Exists [${filename}]: ${url}`)
                return
            }
        }
        try {
            const headersValues = headers ? Object.fromEntries(headers.map(header => header.split(/: ?/))) : {}
            if (verbose) alert(`Requesting: ${url}` + (headersValues ? ' ' + stringifyObject(headersValues) : ''))
            const response = await instance({
                url,
                headers: headersValues,
                responseType: 'arraybuffer'
            })
            await FSExtra.writeFile(`${depository}/${filename}`, response.data)
        }
        catch (e) {
            alert(`Error on row ${row.line}: ${e.message}`)
        }
    }
}

function source(filename) {
    let line = 1
    return Scramjet.StringStream.from(FSExtra.createReadStream(filename)).CSVParse({ header: true }).map(data => {
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
