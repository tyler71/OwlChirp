### Libraries
- [Amazon Stream Connect](https://github.com/amazon-connect/amazon-connect-streams/blob/master/Documentation.md#connectcore)
- [Amazon Connect API](https://docs.aws.amazon.com/connect/latest/APIReference/Welcome.html)
- [AWS Env variables](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-envvars.html)
- [GetCurrentMetricData Boto3](https://docs.aws.amazon.com/connect/latest/APIReference/API_GetCurrentMetricData.html)


## Setup
Environment variables
- LOG_LEVEL
During build / deployment
- CONNECT_INSTANCE
- TIME_ZONE
During hosting
- AWS_ACCESS_KEY_ID
- AWS_SECRET_ACCESS_KEY
- AWS_DEFAULT_REGION
- CONNECT_INSTANCE
- CONNECT_DOMAIN
- DB_STRING
- APP_PORT

## Compile
Manually compiling the front end
In app/client:
```bash
npm run prod
```
This will create a folder call `dist/`
Copy this to app/server/static.
You can also run `compile.sh`

## Development
Run these two commands:
```bash
npm run watch
python app/server
```
