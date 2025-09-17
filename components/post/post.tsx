'use client'

import { useEffect, useMemo, useState } from 'react'
import { Post as PostType, User } from '@/lib/types'
import { PostCard } from './post-card'
import { profileService } from '@/lib/services/profile-service'

interface PostProps {
  doc?: any
  post?: PostType
  hideAvatar?: boolean
  currentUserId?: string | null
}

export function Post({ doc, post: preTransformed, hideAvatar = false, currentUserId = null }: PostProps) {
  // Determine if we received a fully transformed post object
  const hasPreTransformed = !!(preTransformed && preTransformed.author && preTransformed.createdAt instanceof Date)

  // Derive fields from doc (safe defaults); hooks must run unconditionally
  const ownerId: string = (doc && (doc.$ownerId || doc.ownerId || doc.owner || doc.owner_id)) || 'unknown'
  const id: string = (doc && (doc.$id || doc.id)) || Math.random().toString(36).slice(2)
  const content: string = (doc?.data?.content ?? doc?.content ?? '')
  const createdAtMs: number = (doc && (doc.$createdAt || doc.createdAt)) || Date.now()
  const createdAt = useMemo(() => new Date(createdAtMs), [createdAtMs])

  const defaultUser: User = {
    id: ownerId,
    username: ownerId ? `${ownerId.slice(0, 6)}…` : 'unknown',
    displayName: ownerId ? `${ownerId.slice(0, 6)}…` : 'Unknown',
    avatar: '',
    bio: '',
    followers: 0,
    following: 0,
    verified: false,
    joinedAt: createdAt
  }

  const [author, setAuthor] = useState<User>(defaultUser)

  useEffect(() => {
    if (hasPreTransformed) return
    let mounted = true
    ;(async () => {
      try {
        const profile = await profileService.getProfile(ownerId)
        if (profile && mounted) {
          setAuthor({ ...defaultUser, ...profile })
        }
      } catch {
        // Keep default fallbacks on failure
      }
    })()
    return () => { mounted = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, hasPreTransformed])

  const finalPost: PostType = hasPreTransformed
    ? preTransformed!
    : {
        id,
        author,
        content: content || '',
        createdAt,
        likes: 0,
        reposts: 0,
        replies: 0,
        views: 0,
        liked: false,
        reposted: false,
        bookmarked: false,
      }

  const isOwnPost = currentUserId ? currentUserId === finalPost.author.id : false

  return (
    <PostCard 
      post={finalPost} 
      hideAvatar={hideAvatar} 
      isOwnPost={isOwnPost} 
      currentUserId={currentUserId}
    />
  )
}
