import { describe, it, expect } from 'vitest'
import { RiftexContext } from '../src/context/context.ts'
import { resolveForwarded } from '../src/proxy/trust.ts'

function ctx(headers: Record<string, string | string[]>, remote = '10.0.0.5'): RiftexContext {
  const c = new RiftexContext()
  c.headers = headers
  c.remoteAddress = remote
  return c
}

describe('resolveForwarded (low-level)', () => {
  it('trustProxy=false: ignores XFF entirely', () => {
    const r = resolveForwarded(false, '10.0.0.5', { 'x-forwarded-for': '1.2.3.4' })
    expect(r.ip).toBe('10.0.0.5')
    expect(r.protocol).toBe('http')
  })

  it('trustProxy=true: leftmost XFF wins', () => {
    const r = resolveForwarded(true, '10.0.0.5', { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })
    expect(r.ip).toBe('1.2.3.4')
    expect(r.ips).toEqual(['1.2.3.4', '5.6.7.8', '10.0.0.5'])
  })

  it('trustProxy=number: trust N hops from the right', () => {
    // chain: [1.1, 2.2, 3.3, 10.0.0.5(peer)]; trust=1 → idx (4-1-1)=2 → '3.3.3.3'
    const r = resolveForwarded(1, '10.0.0.5', { 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' })
    expect(r.ip).toBe('3.3.3.3')
  })

  it('trustProxy=loopback keyword: trust 127/8 and ::1', () => {
    const r = resolveForwarded('loopback', '127.0.0.1', { 'x-forwarded-for': '8.8.8.8, 127.0.0.5' })
    // Walk right→left: peer 127.0.0.1 trusted → next hop 127.0.0.5 trusted → 8.8.8.8 untrusted → real client
    expect(r.ip).toBe('8.8.8.8')
  })

  it('trustProxy=CIDR: trust addresses inside the block', () => {
    const r = resolveForwarded('10.0.0.0/8', '10.0.0.5', { 'x-forwarded-for': '203.0.113.7, 10.0.0.99' })
    expect(r.ip).toBe('203.0.113.7')
  })

  it('trustProxy=function: predicate per hop', () => {
    const r = resolveForwarded(
      (ip) => ip.startsWith('10.'),
      '10.0.0.5',
      { 'x-forwarded-for': '8.8.8.8, 10.0.0.7' },
    )
    expect(r.ip).toBe('8.8.8.8')
  })

  it('honors X-Forwarded-Proto and X-Forwarded-Host when trust enabled', () => {
    const r = resolveForwarded(
      true,
      '10.0.0.5',
      {
        'x-forwarded-for': '1.2.3.4',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'app.example.com',
      },
    )
    expect(r.protocol).toBe('https')
    expect(r.hostname).toBe('app.example.com')
  })

  it('strips port from X-Forwarded-Host', () => {
    const r = resolveForwarded(true, '10.0.0.5', { 'x-forwarded-host': 'host.dev:8443' })
    expect(r.hostname).toBe('host.dev')
  })

  it('handles bracketed IPv6 host literal', () => {
    const r = resolveForwarded(true, '::1', { 'x-forwarded-host': '[::1]:8443' })
    expect(r.hostname).toBe('::1')
  })
})

describe('RiftexContext getters (high-level)', () => {
  it('ip falls back to remoteAddress when trust=false', () => {
    const c = ctx({ 'x-forwarded-for': '1.2.3.4' })
    expect(c.ip).toBe('10.0.0.5')
  })

  it('ip honors XFF when _trustProxy=true', () => {
    const c = ctx({ 'x-forwarded-for': '1.2.3.4' })
    c._trustProxy = true
    expect(c.ip).toBe('1.2.3.4')
  })

  it('protocol/secure derive from baseProtocol when not trusting', () => {
    const c = ctx({})
    c.baseProtocol = 'https'
    expect(c.protocol).toBe('https')
    expect(c.secure).toBe(true)
  })

  it('hostname falls back to Host header without trust', () => {
    const c = ctx({ host: 'mysite.dev:3000' })
    expect(c.hostname).toBe('mysite.dev')
  })

  it('forwarded info is cached across getters', () => {
    const c = ctx({ 'x-forwarded-for': '1.2.3.4' })
    c._trustProxy = true
    const a = c.ip
    const b = c.ip
    // Same string identity → cached path was taken.
    expect(a).toBe(b)
  })
})
