import FSExtra from 'fs-extra'
import Scramjet from 'scramjet'
import Axios from 'axios'
import AxiosRetry from 'axios-retry'
import AxiosRateLimit from 'axios-rate-limit'

function fetcher(urlColumn, nameColumn, depository, limit, retries, check, verbose, alert) {
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
    return async row => {
        const key = row[nameColumn]
        if (!key) {
            alert('Key column is empty!')
            return
        }
        const url = row[urlColumn]
        if (!url) {
            alert('URL column is empty!')
            return
        }
        if (check) {
            const exists = await FSExtra.pathExists(`${depository}/${key}`)
            if (exists && verbose) {
                alert(`Exists [${key}]: ${url}`)
                return
            }
        }
        try {
            if (verbose) alert(`Requesting: ${url}`)
            const response = await instance({
                url,
                responseType: 'arraybuffer'
            })
            await FSExtra.writeFile(`${depository}/${key}`, response.data)
        }
        catch (e) {
            alert(toErrorMessage(e))
        }
    }
}

function source(filename) {
    return Scramjet.StringStream.from(FSExtra.createReadStream(filename)).CSVParse({ header: true })
}

function length(filename) {
    return source(filename).reduce(a => a + 1, 0)
}

async function run(filename, urlColumn, nameColumn, depository, limit, retries, check, verbose, alert) {
    await FSExtra.ensureDir(depository)
    const fetch = fetcher(urlColumn, nameColumn, depository, limit, retries, check, verbose, alert)
    return source(filename).each(fetch)
}

export default { run, length }
