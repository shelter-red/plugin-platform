import { strict as assert } from 'node:assert'
import { parseResponseStatus, responseHeaders } from './src/response-validation.ts'

assert.equal(parseResponseStatus(undefined), null)
assert.equal(parseResponseStatus(599), 599)
assert.equal(parseResponseStatus(199), null)
assert.equal(parseResponseStatus(600), null)
assert.equal(parseResponseStatus(200.5), null)

const headers = responseHeaders({
  'content-type': 'text/plain',
  'x-invalid\nname': 'ignored',
  'x-number': 10,
  'x-plugmesh-bridge-error': 'server-offline',
  'set-cookie': ['first=1; Path=/', 'bad\nvalue', 'second=2; Path=/'],
  'x-array-number': ['valid', 10],
})
assert.equal(headers.get('content-type'), 'text/plain')
assert.equal([...headers.keys()].includes('x-invalid\nname'), false)
assert.equal([...headers.keys()].includes('x-number'), false)
assert.equal(headers.has('x-plugmesh-bridge-error'), false)
assert.deepEqual(headers.getSetCookie(), ['first=1; Path=/', 'second=2; Path=/'])
assert.equal(headers.get('x-array-number'), 'valid')
console.log('response validation smoke test passed')
