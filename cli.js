import Readline from 'readline'
import FSExtra from 'fs-extra'
import Process from 'process'
import Yargs from 'yargs'
import Progress from 'progress'
import csvFetch from './csv-fetch.js'

function alert(message) {
    Readline.clearLine(process.stderr)
    Readline.cursorTo(process.stderr, 0)
    console.error(message)
}

function ticker(text, total) {
    const progress = new Progress(text + ' |:bar| :percent / :etas left', {
        total,
        width: Infinity,
        complete: '█',
        incomplete: ' '
    })
    return () => progress.tick()
}

async function setup() {
    const instructions = Yargs(Process.argv.slice(2))
        .usage('Usage: csv-fetch <url-column> <name-column> <depository> <filename>')
        .wrap(null)
        .option('l', { alias: 'limit', type: 'number', nargs: 1, describe: 'Limit the number of requests made per second' })
        .option('r', { alias: 'retries', type: 'number', nargs: 1, describe: 'Number of times a request should be retried', default: 5 })
        .option('c', { alias: 'check', type: 'boolean', describe: 'Check whether file has already been downloaded, and skip if so', default: false })
        .option('V', { alias: 'verbose', type: 'boolean', describe: 'Print every request made', default: false })
        .help('?').alias('?', 'help')
        .version().alias('v', 'version')
    if (instructions.argv._.length === 0) instructions.showHelp().exit(0)
    try {
        const {
            _: [urlColumn, nameColumn, depository, filename],
            limit,
            retries,
            check,
            verbose
        } = instructions.argv
        if (filename === '-') throw new Error('reading from standard input not supported')
        const exists = await FSExtra.pathExists(filename)
        if (!exists) throw new Error(`${filename}: could not find file`)
        const total = await csvFetch.length(filename)
        console.error('Starting up...')
        const process = await csvFetch.run(filename, urlColumn, nameColumn, depository, limit, retries, check, verbose, alert)
        await process
            .each(ticker('Working...', total))
            .whenEnd()
        console.error('Done!')
    }
    catch (e) {
        console.error(e.message)
        Process.exit(1)
    }

}

setup()
