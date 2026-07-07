import { Api } from 'telegram';
import { getClient } from '../src/lib/telegram';

async function testRange() {
  const client = await getClient();
  console.log("Client ready");
  // Just to see if it imports correctly
}

testRange();
