import FSExtra from 'fs-extra'
import Process from 'process'
import Yargs from 'yargs'
import csvFetch from './csv-fetch.js'
import cliRenderer from './cli-renderer.js'

async function setup() {
    const instructions = Yargs(Process.argv.slice(2))
        .parserConfiguration({ 'flatten-duplicate-arrays': false })
        .usage('Usage: csv-fetch <url-column> <name-column> <depository> <filename>')
        .wrap(null)
        .completion('completion', false)
        .option('d', { alias: 'subdirectories', type: 'string', describe: 'A column to be used to create subdirectories' })
        .option('s', { alias: 'suffix', type: 'string', describe: 'A suffix to add to the name of each file, such as an extension' })
        .option('h', { alias: 'headers', type: 'string', array: true, describe: 'A space-separated list of headers to be sent with the requests' })
        .option('l', { alias: 'limit', type: 'number', nargs: 1, describe: 'Limit the number of requests made per second' })
        .option('r', { alias: 'retries', type: 'number', nargs: 1, describe: 'Number of times a request should be retried', default: 5 })
        .option('c', { alias: 'check-file', type: 'boolean', describe: 'Check for an existing file, and skip if so', default: false })
        .option('C', { alias: 'check-cache', type: 'boolean', describe: 'Check a fast cache for whether it includes the file, and skip if so', default: false })
        .option('V', { alias: 'verbose', type: 'boolean', describe: 'Print every request made', default: false })
        .help('?').alias('?', 'help')
        .version().alias('v', 'version')
    if (instructions.argv['get-yargs-completions']) Process.exit(0)
    if (instructions.argv._.length === 0) instructions.showHelp().exit(0)
    const {
        _: [urlColumn, nameColumn, depository, filename],
        subdirectories,
        suffix,
        headers,
        limit,
        retries,
        checkFile,
        checkCache,
        verbose
    } = instructions.argv
    if (filename === '-') throw new Error('reading from standard input not supported')
    const exists = await FSExtra.pathExists(filename)
    if (!exists) throw new Error(`${filename}: could not find file`)
    const headerlist = headers && !Array.isArray(headers[0]) ? [headers] : headers
    if (headerlist) headerlist.forEach(headerset => {
        headerset.forEach(header => {
            if (!header.includes(':')) throw new Error(`"${header}" header is not valid`)
        })
    })
    console.error('Starting up...')
    const total = await csvFetch.length(filename)
    const { alert, progress, finalise } = cliRenderer(instructions.argv.verbose)
    try {
        const process = await csvFetch.run(filename, urlColumn, nameColumn, depository, subdirectories, suffix, headerlist, limit, retries, checkFile, checkCache, alert)
        await process
            .each(progress('Working...', total))
            .whenEnd()
        await finalise('complete')
    }
    catch (e) {
        await finalise('error')
        console.error(instructions.argv.verbose ? e.stack : e.message)
        Process.exit(1)
    }

}

setup()
