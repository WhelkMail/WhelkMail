import { generateKeyPairSync } from 'node:crypto'

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const publicJwk = publicKey.export({ format: 'jwk' })
const privateJwk = privateKey.export({ format: 'jwk' })

const x = Buffer.from(publicJwk.x, 'base64url')
const y = Buffer.from(publicJwk.y, 'base64url')
const rawPublic = Buffer.concat([Buffer.from([4]), x, y])

console.log(`VAPID_PUBLIC_KEY=${rawPublic.toString('base64url')}`)
console.log(`VAPID_PRIVATE_KEY=${privateJwk.d}`)
console.log('VAPID_SUBJECT=mailto:you@example.com')
