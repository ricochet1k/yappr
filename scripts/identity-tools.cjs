#!/usr/bin/env node
/*
Utility for testnet identity keys.

Usage:
  node scripts/identity-tools.cjs generate           # prints new WIF and address (testnet)
  node scripts/identity-tools.cjs show <WIF>         # prints address and tries to fetch identity (if any)
  node scripts/identity-tools.cjs register <WIF>     # registers an identity (requires funded address)

Notes:
  - Uses Dash testnet. Fund the printed address via a testnet faucet before register.
  - Registration consumes credits; expect a short delay for propagation.
*/

const Dash = require('dash')

async function generate() {
  const pk = new Dash.Core.PrivateKey(null, 'testnet')
  const wif = pk.toWIF()
  const address = pk.toAddress().toString()
  console.log('network: testnet')
  console.log('privateKeyWIF:', wif)
  console.log('address:', address)
}

async function show(wif) {
  if (!wif) throw new Error('Missing WIF')
  const pk = Dash.Core.PrivateKey.fromWIF(wif)
  const address = pk.toAddress().toString()
  console.log('network: testnet')
  console.log('privateKeyWIF:', wif)
  console.log('address:', address)

  const client = new Dash.Client({ network: 'testnet', wallet: { mnemonic: null, privateKey: wif } })
  try {
    const account = await client.getWalletAccount()
    const balance = account.getConfirmedBalance()
    console.log('confirmedBalance:', balance)
    // Try to find identity by first account identity (if any)
    const identities = await client.platform.identities.getIdentityIdsByPublicKeyHash(
      Buffer.from(Dash.Core.crypto.Hash.sha256ripemd160(pk.publicKey.toBuffer()))
    )
    if (identities && identities.length) {
      console.log('identityId:', identities[0])
    } else {
      console.log('identityId: (not found for this key)')
    }
  } catch (e) {
    console.warn('show: non-fatal error:', e?.message || e)
  } finally {
    client.disconnect()
  }
}

async function register(wif) {
  if (!wif) throw new Error('Missing WIF')
  const client = new Dash.Client({ network: 'testnet', wallet: { mnemonic: null, privateKey: wif } })
  try {
    console.log('Registering identity on testnet...')
    const identity = await client.platform.identities.register()
    const id = identity.getId().toString()
    console.log('identityId:', id)
    console.log('Done.')
  } catch (e) {
    console.error('Failed to register identity:', e?.message || e)
    console.error('Ensure the address has testnet funds and try again.')
    process.exitCode = 1
  } finally {
    client.disconnect()
  }
}

async function main() {
  const [cmd, maybeWif] = process.argv.slice(2)
  try {
    if (cmd === 'generate') return await generate()
    if (cmd === 'show') return await show(maybeWif)
    if (cmd === 'register') return await register(maybeWif)
    console.log('Usage:')
    console.log('  node scripts/identity-tools.cjs generate')
    console.log('  node scripts/identity-tools.cjs show <WIF>')
    console.log('  node scripts/identity-tools.cjs register <WIF>')
    process.exitCode = 1
  } catch (e) {
    console.error('Error:', e?.message || e)
    process.exitCode = 1
  }
}

main()

