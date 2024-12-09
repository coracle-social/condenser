import 'dotenv/config'
import WebSocket from 'ws';
import { Mistral } from '@mistralai/mistralai';
import { Relay, Event, finalizeEvent } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils';

global.WebSocket = WebSocket as any

const TIMEFRAME = 24 * 60 * 60;
const READ_RELAY_URL = 'wss://news.utxo.one';
const WRITE_RELAY_URL = 'wss://nos.lol';

const mistral = new Mistral({apiKey: process.env.MISTRAL_API_KEY!});

const templatePrompt = `
<example>
1. A summary of the current event in some detail, omitting any headline.

Source: hyperlink to the relevant source goes here
</example>

<data>
{DATA}
</data>

<instructions>
You are a substack blogger who keeps up on current events. \
Your task is to summarize the top current events of the day.
Please follow these steps carefully:

1. Analyze the <example> to understand my desired style and format. \
   In <thinking_template> tags, summarize the key characteristics of my template.
2. Read the events in <data>. In <thinking_data> tags, summarize which events
   were mentioned by the most sources. Do not include events related to sports
   or pop culture, or the story mentioned by <example>.
3. In <output> tags, list the top 5 current events.
  a) Focus on important macro events
  b) Number each event in sequence
  c) Summaries should be exactly 200 words
  d) Each event should reference the most relevant link
  e) Summaries should follow <example> exactly
  f) Do not use markdown to format links

Be as clear, concise, and specific as possible.
</instructions>
`

async function fetchEvents(): Promise<Event[]> {
  const relay = await Relay.connect(READ_RELAY_URL)
  const filters = [{
    since: Math.floor(Date.now() / 1000) - TIMEFRAME,
    kinds: [1],
  }]

  return new Promise(resolve => {
    const events: Event[] = []

    relay.subscribe(filters, {
      onevent(event) {
        events.push(event)
      },
      oneose() {
        relay.close()
        resolve(events)
      }
    })
  })
}

async function analyzeEvents(events: any[]) {
  const content = events.map(e => e.content).join('\n\n')
  const prompt = templatePrompt.replace('{DATA}', content)
  const response = await mistral.chat.complete({
    model: 'mistral-tiny',
    maxTokens: 2000,
    messages: [{
      role: 'user',
      content: prompt.trim(),
    }]
  });

  // @ts-ignore
  return response.choices[0].message.content as string;
}

async function main() {
  const events = await fetchEvents()

  console.log(`Summarizing ${events.length} events from the last 24 hours`)

  let content
  while (!content) {
    content = await analyzeEvents(events)

    if (!process.env.DRY_RUN) {
      content = content.match(/output\>([\s\S.]*)\<\/output/)?.[1]
    }
  }

  const secret = hexToBytes(process.env.APP_SECRET!);
  const created_at = Math.floor(Date.now() / 1000);
  const template = {kind: 1, created_at, tags: [], content};
  const event = finalizeEvent(template, secret);
  const relay = await Relay.connect(WRITE_RELAY_URL);

  if (process.env.DRY_RUN === 'true') {
    console.log(event.content);
  } else {
    await relay.publish(event);
  }

  relay.close();

  console.log(`Done!`)
}

main().catch(console.error);
