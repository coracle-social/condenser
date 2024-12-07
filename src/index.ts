import 'dotenv/config'
import WebSocket from 'ws';
import { Mistral } from '@mistralai/mistralai';
import { Relay, Event, finalizeEvent } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils';

global.WebSocket = WebSocket as any

const TIMEFRAME = 6 * 60 * 60;
const READ_RELAY_URL = 'wss://news.utxo.one';
const WRITE_RELAY_URL = 'wss://nos.lol';

const mistral = new Mistral({apiKey: process.env.MISTRAL_API_KEY!});

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
  const prompt = `
  Read the following headlines:
  =============================================================================
  ${content}
  =============================================================================
  Now, please identify the 5 most mentioned events in world events, politics, business, and economy.
  For each event, provide a brief summary and the most relevant link. Do not use markdown.
  Do not duplicate entries. Strip url trackers.
  `
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

  console.log(`Summarizing ${events.length} events from the last 6 hours`)

  const content = await analyzeEvents(events);
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
