import os

from botocore.exceptions import ClientError
from quart import Quart, request, render_template, make_response, abort, send_file

from lib.Database import Db
from lib.Events import ServerSentEvents, get_metric_data, cm
from lib.Helper import sync_to_async
import logging

events = ServerSentEvents(["queue_count",
                           "available_count",
                           "active_agent_count",
                           'user_list',
                           "handled_incoming",
                           ],
                          get_metric_data)

EVENT_STREAM_HEADER = {
    'Content-Type': "text/event-stream",
    'Cache-Control': 'no-cache',
    'Transfer-Encoding': 'chunked',
}

app = Quart(__name__)


class HttpResponse:
    CREATED = 201


@app.route('/')
async def index():
    return await render_template('index.html')


@app.route('/ccp')
async def ccp():
    return await render_template('ccp.html',
                                 LOADING_CLASS="alert-secondary")


# We're not sending static as this file will often change.
@app.route('/ccp.js')
async def js_ccp():
    dir_path = os.path.dirname(os.path.realpath(__file__))
    js_file = os.path.join(dir_path, "static/scripts/core.js")
    content = await send_file(js_file,
                              mimetype='application/javascript', as_attachment=False)
    response = await make_response(content)
    if 'Cache-Control' not in response.headers:
        response.headers['Cache-Control'] = 'no-store'
    return response


@app.route('/api/metrics')
async def metrics():
    if "text/event-stream" not in request.accept_mimetypes:
        abort(400)
    response = await make_response(
        events.get_data_generator(server_sent_event=True),
        EVENT_STREAM_HEADER,
    )
    response.timeout = None
    return response


@app.route('/api/metrics/events')
async def metric_events():
    if "text/event-stream" not in request.accept_mimetypes:
        abort(400)
    response = await make_response(
        events.get_data_event_generator(server_sent_event=True),
        EVENT_STREAM_HEADER,
    )
    response.timeout = None
    return response


@app.route('/api/calls/agent', methods=["GET", "POST"])
async def agent_call_log():
    username = request.args.get("username")
    db = Db()
    await db.init()
    if request.method == 'GET':
        max_records = request.args.get("max_records", None)
        if not await db.verify_user(username):
            await db.add_user(username)
        rows = await db.get_agent_calls(username=username, max_records=max_records)
        converted_rows = list()
        for row in rows:
            converted_row = {
                'agent': row.agent.username,
                'phoneNumber': row.phone_number,
                'timestamp': row.timestamp,
                'contactId': row.contact_id,
            }
            converted_rows.append(converted_row)
        return converted_rows

    elif request.method == 'POST':
        data = await request.get_json()
        await db.add_phone_log(
            username=data["agent"],
            phone_number=data["phoneNumber"],
            timestamp=data["timestamp"],
            contact_id=data["contactId"],
        )
        return '', HttpResponse.CREATED


@app.route('/api/calls/number')
async def number_call_log():
    db = Db()
    await db.init()
    phone_number = request.args.get("phone_number", None)
    max_records = request.args.get("max_records", None)
    rows = await db.get_phone_calls(phone_number=phone_number, max_records=max_records)
    converted_rows = list()
    for row in rows:
        converted_row = {
            "phoneNumber": row.phone_number,
            "timestamp": row.timestamp,
            "agent": row.agent.username,
        }
        converted_rows.append(converted_row)

    return converted_rows


@app.route('/api/calls/detail')
async def contact_detailed_info():
    contact_id = request.args.get("contact_id", None)
    try:
        user_data = await sync_to_async(cm.describe_contact, contact_id)()
        return user_data
    except ClientError as e:
        logging.error(e)
        return "", 404


@app.route('/api/calls/callerid', methods=["GET", "PUT"])
async def caller_id():
    db = Db()
    await db.init()
    if request.method == "GET":
        phone_number = request.args.get("phone_number", None)
        res = await db.get_caller_id(phone_number=phone_number)
        if res is None:
            return "", 404
        else:
            converted_output = {
                "name": res.name,
                "phoneNumber": res.phone_number,
            }
            return converted_output
    elif request.method == "PUT":
        data = await request.get_json()
        phone_number = data['phone_number']
        name = data['name']
        if await db.update_caller_id(phone_number=phone_number, name=name) is True:
            return "", 204
