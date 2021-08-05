CSV Fetch
=========

Download a list of URLs from a CSV file.


Installing
----------

    $ npm install -g csv-fetch

Alternatively, don't install it and just prepend the below commands with `npx`.


Usage
-----

    $ csv-fetch <url-column> <name-column> <depository> <filename>

Where `<filename>` is the name of your CSV, `<depository>` is the name of a directory where the files will be downloaded to, `<name-column>` is a column from the CSV file with unique identifiers for each row, and `<url-column>` is a column from the CSV file with the URLs of the files to be fetched.

Note the identifiers in the name column should be unique, otherwise files will be overwritten -- or skipped, if the `-c` flag is given.

Requests are made as fast as possible by default. The `-l` flag lets you set a rate limit for the maximum number that should be made per second.

HTTP requests are automatically retried if they fail, five times by default, but this can be adjusted with the `-r` flag.

Request checking can be turned on with the `-c` flag. This will check to see whether there is an existing file in your depository for each row, and skip making the request if so.
