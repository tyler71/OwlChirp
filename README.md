### Libraries
- [Amazon Stream Connect](https://github.com/amazon-connect/amazon-connect-streams/blob/master/Documentation.md#connectcore)
- [Amazon Connect API](https://docs.aws.amazon.com/connect/latest/APIReference/Welcome.html)
- [AWS Env variables](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-envvars.html)
- [GetCurrentMetricData Boto3](https://docs.aws.amazon.com/connect/latest/APIReference/API_GetCurrentMetricData.html)


## Setup
**LOG_LEVEL**
Changes the log level.
Example values, `ERROR` `INFO` `WARNING` `DEBUG`

**CONNECT_INSTANCE**
Used for Amazon's CCP initialization to load up the softphone client.
It is also used for connecting to AWS Api's on the backend for retrieving current helpdesk metrics

If the ARN is `arn:aws:connect:region:80425687320769973081:instance/97gytsbv-fe8b-g02zq-hf7f-f7fdk80yheafo`
Then this value would be `97gytsbv-fe8b-g02zq-hf7f-f7fdk80yheafo`.

**TIME_ZONE**
Localizes the time zone for when calls come in, as well as getting accurate metrics such as the number of calls

[List of country codes](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)

Example:
```
America/Los_Angeles
```

**AWS_DEFAULT_REGION**
Required for connecting to AWS Api's
**DB_STRING**
Used for connecting to the database. Uses Quart ORM.
Example: 
```
sqlite+aiosqlite:////data/owlchirp.sqlite3
```

**APP_PORT**
Change the port the application uses for the server.
Default `4180`

## Compile
Manually compiling the front end
In app/client:
```bash
npm run prod
```
This will create a folder call `dist/`
Copy this to app/server/static.
You can also run `compile.sh`

Then run 
```bash
python app/server
```

## Development
Run these two commands:
```bash
npm run watch
python app/server
```
