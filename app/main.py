from quart import Quart, request, render_template, make_response, abort

from lib.Database import Db
from lib.Events import ServerSentEvents, get_metric_data

events = ServerSentEvents(["queue_count",
                           "available_count",
                           "active_agent_count",
                           'user_list',
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
    return await render_template('ccp.html')


# @app.route('/api/metrics')
# def metrics():
#     return Response(events.get_data_generator(server_sent_event=True), mimetype=MIME_EVENT_STREAM)

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


@app.route('/api/calls/agent/<username>', methods=["GET", "POST"])
async def agent_call_log(username):
    db = Db()
    await db.init()
    if request.method == 'GET':
        if not await db.verify_user(username):
            await db.add_user(username)
        rows = await db.get_agent_calls(username)
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


@app.route('/api/calls/number/<phone_number>')
async def number_call_log(phone_number):
    db = Db()
    await db.init()
    rows = await db.get_phone_calls(phone_number)
    converted_rows = list()
    for row in rows:
        converted_row = {
            "phoneNumber": row.phone_number,
            "timestamp": row.timestamp,
            "agent": row.agent.username,
        }
        converted_rows.append(converted_row)

    return converted_rows


