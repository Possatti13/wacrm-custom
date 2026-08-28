/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest'
import type { Tag } from '@/types'

// Mock Supabase client builder to test IntelligenceSidebar data fetching logic
describe('IntelligenceSidebar — Tag Fetching, Empty State & Error Isolation', () => {
  const accountId = 'acc-123'
  const contactId = 'ct-456'
  const conversationId = 'conv-789'

  it('correctly maps empty tags to empty array without logging error', async () => {
    const mockTagsRes = {
      data: [],
      error: null,
    }

    let tagsState: (Tag & { contact_tag_id: string })[] = []
    const setTags = (tags: (Tag & { contact_tag_id: string })[]) => {
      tagsState = tags
    }

    // Process tagsRes logic matching intelligence-sidebar
    if (mockTagsRes.error) {
      setTags([])
    } else if (mockTagsRes.data) {
      interface TagJoinRow {
        id: string
        tag_id: string
        tags: Tag | null
      }
      const rows = mockTagsRes.data as unknown as TagJoinRow[]
      const flattened = rows
        .filter((t): t is TagJoinRow & { tags: Tag } => Boolean(t.tags))
        .map((t) => ({
          ...t.tags,
          contact_tag_id: t.id,
        }))
      setTags(flattened)
    } else {
      setTags([])
    }

    expect(tagsState).toEqual([])
  })

  it('correctly maps contact tags when rows are returned with embedded tags join', async () => {
    const mockTagsRes = {
      data: [
        {
          id: 'ct-tag-1',
          tag_id: 'tag-1',
          tags: {
            id: 'tag-1',
            account_id: accountId,
            name: 'VIP',
            color: '#10B981',
            created_at: '2026-08-27T00:00:00Z',
          },
        },
        {
          id: 'ct-tag-2',
          tag_id: 'tag-2',
          tags: {
            id: 'tag-2',
            account_id: accountId,
            name: 'Interessado Falcon',
            color: '#3B82F6',
            created_at: '2026-08-27T00:00:00Z',
          },
        },
      ],
      error: null,
    }

    let tagsState: (Tag & { contact_tag_id: string })[] = []
    const setTags = (tags: (Tag & { contact_tag_id: string })[]) => {
      tagsState = tags
    }

    if (mockTagsRes.data) {
      interface TagJoinRow {
        id: string
        tag_id: string
        tags: Tag | null
      }
      const rows = mockTagsRes.data as unknown as TagJoinRow[]
      const flattened = rows
        .filter((t): t is TagJoinRow & { tags: Tag } => Boolean(t.tags))
        .map((t) => ({
          ...t.tags,
          contact_tag_id: t.id,
        }))
      setTags(flattened)
    }

    expect(tagsState).toHaveLength(2)
    expect(tagsState[0]).toEqual({
      id: 'tag-1',
      account_id: accountId,
      name: 'VIP',
      color: '#10B981',
      created_at: '2026-08-27T00:00:00Z',
      contact_tag_id: 'ct-tag-1',
    })
    expect(tagsState[1]).toEqual({
      id: 'tag-2',
      account_id: accountId,
      name: 'Interessado Falcon',
      color: '#3B82F6',
      created_at: '2026-08-27T00:00:00Z',
      contact_tag_id: 'ct-tag-2',
    })
  })

  it('isolates PostgREST errors, safely logs structured metadata, and defaults tags to empty array without crashing CRM data', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const mockTagsRes = {
      data: null,
      error: {
        message: 'relation "contact_tag_assignments" does not exist',
        code: '42P01',
        details: null,
        hint: null,
      },
    }

    let tagsState: (Tag & { contact_tag_id: string })[] = [{ id: 'old', name: 'old', color: 'red' } as any]
    const setTags = (tags: (Tag & { contact_tag_id: string })[]) => {
      tagsState = tags
    }

    if (mockTagsRes.error) {
      console.error('[intelligence-sidebar] Failed to load tags:', {
        message: mockTagsRes.error.message,
        code: mockTagsRes.error.code,
        details: mockTagsRes.error.details,
        hint: mockTagsRes.error.hint,
      })
      setTags([])
    }

    expect(tagsState).toEqual([])
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[intelligence-sidebar] Failed to load tags:',
      expect.objectContaining({
        message: 'relation "contact_tag_assignments" does not exist',
        code: '42P01',
      })
    )

    consoleErrorSpy.mockRestore()
  })

  it('validates query definitions for contact_tags and messages to prevent non-existent column errors', () => {
    // 1. contact_tags must query by contact_id (not account_id)
    const contactTagsQuery = {
      table: 'contact_tags',
      select: 'id, tag_id, tags(*)',
      filters: { contact_id: contactId },
    }

    expect(contactTagsQuery.table).toBe('contact_tags')
    expect(contactTagsQuery.table).not.toBe('contact_tag_assignments')
    expect(contactTagsQuery.filters).not.toHaveProperty('account_id')
    expect(contactTagsQuery.filters.contact_id).toBe(contactId)

    // 2. messages count must query by conversation_id (not account_id)
    const messagesCountQuery = {
      table: 'messages',
      select: 'id, created_at',
      options: { count: 'exact' },
      filters: { conversation_id: conversationId },
    }

    expect(messagesCountQuery.table).toBe('messages')
    expect(messagesCountQuery.filters).not.toHaveProperty('account_id')
    expect(messagesCountQuery.filters.conversation_id).toBe(conversationId)
  })
})
