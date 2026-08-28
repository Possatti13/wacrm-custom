/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest'
import {
  getWahaChats,
  getWahaChatMessages,
  resolveWahaLidToPhoneNumber,
  type WahaConfig,
} from './waha-api'

describe('WAHA API Client — URL Construction, Parameter Encoding & LID Handling', () => {
  const config: WahaConfig = {
    baseUrl: 'http://localhost:3001',
    apiKey: 'secret123',
    session: 'ciclopes_sess',
  }

  it('correctly constructs URL for @c.us chat with %40 encoding and query parameters', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [],
        text: async () => '[]',
      } as any
    })

    await getWahaChatMessages(config, '5511999998888@c.us', {
      limit: 25,
      downloadMedia: false,
      filterTimestampGte: 1787880000,
    })

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:3001/api/ciclopes_sess/chats/5511999998888%40c.us/messages?limit=25&downloadMedia=false&filter.timestamp.gte=1787880000',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Api-Key': 'secret123' }),
      })
    )

    fetchSpy.mockRestore()
  })

  it('correctly constructs URL for @lid chat with %40 encoding and filters', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [],
        text: async () => '[]',
      } as any
    })

    await getWahaChatMessages(config, '25190000009361@lid', {
      limit: 50,
      offset: 10,
      downloadMedia: true,
      filterTimestampLte: 1787890000,
      filterFromMe: false,
    })

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:3001/api/ciclopes_sess/chats/25190000009361%40lid/messages?limit=50&offset=10&downloadMedia=true&filter.timestamp.lte=1787890000&filter.fromMe=false',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Api-Key': 'secret123' }),
      })
    )

    fetchSpy.mockRestore()
  })

  it('handles chat passed as WAHA WEBJS raw object { _serialized: "..." }', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [],
        text: async () => '[]',
      } as any
    })

    await getWahaChatMessages(
      config,
      { _serialized: '25190000009361@lid', id: '25190000009361@lid' } as any,
      { limit: 10 }
    )

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:3001/api/ciclopes_sess/chats/25190000009361%40lid/messages?limit=10&downloadMedia=false',
      expect.any(Object)
    )

    fetchSpy.mockRestore()
  })

  it('extracts clean string IDs when getWahaChats returns raw WEBJS object IDs', async () => {
    const rawChatsResponse = [
      {
        id: {
          server: 'lid',
          user: '25190000009361',
          _serialized: '25190000009361@lid',
        },
        name: 'Leo Possatti',
        unreadCount: 3,
      },
      {
        id: '5511988887777@c.us',
        name: 'Cliente Regular',
        unreadCount: 0,
      },
    ]

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => rawChatsResponse,
        text: async () => JSON.stringify(rawChatsResponse),
      } as any
    })

    const chats = await getWahaChats(config, { limit: 10 })

    expect(chats).toHaveLength(2)
    expect(chats[0].id).toBe('25190000009361@lid')
    expect(chats[0].name).toBe('Leo Possatti')
    expect(chats[1].id).toBe('5511988887777@c.us')
    expect(chats[1].name).toBe('Cliente Regular')

    fetchSpy.mockRestore()
  })

  it('resolves LID to phone number correctly via GET /api/{session}/lids/{lid}', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/lids/25190000009361%40lid')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            lid: '25190000009361@lid',
            pn: '5513974135365@c.us',
          }),
          text: async () => JSON.stringify({ lid: '25190000009361@lid', pn: '5513974135365@c.us' }),
        } as any
      }
      return { ok: false, status: 404 } as any
    })

    const phone = await resolveWahaLidToPhoneNumber(config, '25190000009361@lid')
    expect(phone).toBe('5513974135365')

    fetchSpy.mockRestore()
  })
})
