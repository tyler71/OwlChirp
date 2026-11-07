# Voice transcription: AWS setup

The **Voice transcription** card on the Phone tab shows a live transcript of what
the **caller** says on the agent's current call. The agent's voice is not
transcribed. This guide covers what you need to set up in AWS for it
to work.

## How it works

```
Caller ⇄ Amazon Connect ──(Start media streaming)──▶ Kinesis Video Stream
                                                          │  GetMedia (live, from "now")
                                                          ▼
                                   Owlchirp backend (Go, in memory)
                                   └─ MKV parse → AUDIO_FROM_CUSTOMER → Transcribe stream
                                      (AUDIO_TO_CUSTOMER, the agent, is ignored)
                                                          │  websocket push (this agent only)
                                                          ▼
                                       Phone tab → Voice transcription card
```

- No Lambda, no S3, no Kinesis Data Streams, no database rows. Audio and text
  stay in backend memory only while a transcription runs. The transcript
  lives in the agent's browser tab and is cleared when the call changes.
- The browser never gets AWS credentials or the stream ARN. It asks for
  `transcribe.start {contactId}`. The backend then checks that the contact
  is connected to *that* agent, using `DescribeContact`, and reads the
  stream ARN from the contact's attributes.
- Transcription starts at the moment the agent presses **Start**. It does
  not replay the IVR or queue time. It stops when the agent presses
  **Stop**, the call ends, the stream moves to the next contact, or the
  agent's websocket disconnects.

> **Retention note:** Amazon Connect requires the Kinesis Video Stream to
> have some data retention (minimum 1 hour). That retention is inside KVS
> and set by AWS. Owlchirp never reads past audio and stores nothing of its
> own. If you need *zero* retained audio, this KVS-based approach can't
> provide it.

---

## 1. Turn on live media streaming for the Connect instance

1. AWS console → **Amazon Connect** → select your instance → **Data storage**.
2. Under **Live media streaming**, choose **Edit** → **Enable live media streaming**.
3. Set a **Prefix**. Connect names streams `<prefix>-connect-<alias>-contact-<id>`;
   you'll scope IAM to this pattern.
4. Choose a **KMS key**. The AWS managed `aws/kinesisvideo` key is fine.
5. Set **Data retention period** to the minimum (1 hour).
6. Save.

## 2. Update the contact flow(s)

In each inbound flow that leads to agents:

1. Before **Transfer to queue**, add a **Start media streaming** block.
   - Check **From the customer**. **To the customer** (the agent's voice)
     isn't needed, and leaving it off means KVS never receives agent audio.
2. Directly after it, add a **Set contact attributes** block:
   - Destination type: **User defined**
   - Destination attribute: `kvsStreamArn` (or whatever you set `KVS_STREAM_ATTRIBUTE` to)
   - Value: **Set dynamically**, Namespace **Media streams**, Attribute **Customer audio stream ARN**
     (`$.MediaStreams.Customer.Audio.StreamARN`)
3. Optional: add **Stop media streaming** in the disconnect flow. Connect
   stops streaming when the contact ends anyway.
4. **Publish** the flow.

Streaming has to start *before* the agent answers. The card can't
retroactively start KVS on a call whose flow didn't do it.

Transfers: attributes live on the initial contact, and the backend reads
them from `InitialContactId`, so transferred calls keep working as long as
the stream is still active.

## 3. IAM permissions for the backend

The backend uses the default AWS credential chain. Today that's
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in `docker-compose.yml`. An
instance or task role also works. Add this policy to that principal,
replacing the region, account, instance ID and stream prefix:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadCallAudio",
      "Effect": "Allow",
      "Action": ["kinesisvideo:GetDataEndpoint", "kinesisvideo:GetMedia"],
      "Resource": "arn:aws:kinesisvideo:us-west-2:123456789012:stream/<prefix>-connect-*-contact-*/*"
    },
    {
      "Sid": "DecryptCallAudio",
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "arn:aws:kms:us-west-2:123456789012:key/<kvs-kms-key-id>",
      "Condition": { "StringEquals": { "kms:ViaService": "kinesisvideo.us-west-2.amazonaws.com" } }
    },
    {
      "Sid": "Transcribe",
      "Effect": "Allow",
      "Action": "transcribe:StartStreamTranscription",
      "Resource": "*"
    },
    {
      "Sid": "FindContactStream",
      "Effect": "Allow",
      "Action": ["connect:DescribeContact", "connect:GetContactAttributes"],
      "Resource": "arn:aws:connect:us-west-2:123456789012:instance/<instance-id>/contact/*"
    }
  ]
}
```

- You can skip the `kms:Decrypt` statement if you chose the AWS managed
  `aws/kinesisvideo` key.
- `connect:DescribeContact` is probably already granted, since the call
  history features use it.

## 4. Backend configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `AWS_DEFAULT_REGION` | `us-west-2` | Must be the Connect instance's region (KVS streams live there). Transcribe streaming must also be available in it. |
| `TRANSCRIBE_LANGUAGE` | `en-US` | Transcribe streaming language code, e.g. `en-US`, `es-US`, `en-GB`. |
| `KVS_STREAM_ATTRIBUTE` | `kvsStreamArn` | Contact attribute holding the stream ARN (step 2). |

These are already passed through in `docker-compose.yml`. Restart the
container after changing them.

## 5. Give agents the feature

Admin → Users. Grant **Voice transcription**. The **Power** and **Admin**
presets include it. Agents without it don't see the card, and the server
rejects their `transcribe.*` requests.

## 6. Test it

1. Call a number routed through the updated flow, and answer as an agent with the feature.
2. Phone tab → **Voice transcription** → **Start**. Within a second or two
   you should see the caller's words as italic partial lines that firm up
   into final ones. Nothing you say appears.
3. Hang up. The card shows "Transcription stopped" and clears once the contact is closed.

## Troubleshooting

| Card shows | Cause / fix |
| --- | --- |
| *media streaming isn't enabled for this call* | The `kvsStreamArn` attribute is missing. Check the flow has Start media streaming **and** Set contact attributes before the queue, and that it's published. Look up the contact in **Contact search** → **Attributes**. |
| *this call isn't connected to you yet* | Pressed Start before the agent leg connected, or another agent's contact ID was sent. Wait for the call to connect. |
| *Transcription failed* | Check the backend logs (`transcription … error=`). Usually `AccessDeniedException`: fix the IAM policy (step 3), including `kms:Decrypt` for a customer managed key. `ResourceNotFoundException` means a wrong region. |
| Starts, but no text | Check that **From the customer** is ticked in Start media streaming and that the caller is talking. Transcribe drops silence. |
| Text stops mid-call | The stream moved to another contact (`contactChanged`), or the websocket reconnected. Press **Restart**. |

## Cost

Each running transcription uses **one** Transcribe streaming session (caller
audio only). It also uses KVS `GetMedia` data consumption. Both are billed per second/GB
only while the card is running. KVS ingestion and storage for the
minimum retention period are billed whenever media streaming is on in the
flow, whether or not anyone transcribes.
