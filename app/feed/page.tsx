'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { SparklesIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { PostCard } from '@/components/post/post-card'
import { Sidebar } from '@/components/layout/sidebar'
import { RightSidebar } from '@/components/layout/right-sidebar'
import { ComposeModal } from '@/components/compose/compose-modal'
import { useAppStore } from '@/lib/store'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { getInitials } from '@/lib/utils'
import * as Tabs from '@radix-ui/react-tabs'
import { withAuth, useAuth } from '@/contexts/auth-context'
import { AvatarCanvas } from '@/components/ui/avatar-canvas'
import { generateAvatarV2 } from '@/lib/avatar-generator-v2'
import { LoadingState, useAsyncState } from '@/components/ui/loading-state'
import ErrorBoundary from '@/components/error-boundary'
import { getDashPlatformClient } from '@/lib/dash-platform-client'
import { cacheManager } from '@/lib/cache-manager'

function FeedPage() {
  const [activeTab, setActiveTab] = useState('for-you')
  const [isHydrated, setIsHydrated] = useState(false)
  const { setComposeOpen } = useAppStore()
  const { user } = useAuth()
  const postsState = useAsyncState<any[]>([])
  
  // Prevent hydration mismatches
  useEffect(() => {
    setIsHydrated(true)
  }, [])
  
  // Generate avatar based on identity ID (only after hydration)
  const avatarFeatures = user && isHydrated ? generateAvatarV2(user.identityId) : null
  
  // Load posts function - using real WASM SDK with updated version
  const loadPosts = useCallback(async (forceRefresh: boolean = false) => {
    // Use the setter functions directly, not the whole postsState object
    const { setLoading, setError, setData } = postsState
    
    setLoading(true)
    setError(null)
    
    try {
      console.log('Feed: Loading posts from Dash Platform...')
      
      const dashClient = getDashPlatformClient()
      
      // Cache key based on active tab and user
      const cacheKey = activeTab === 'your-posts' && user?.identityId 
        ? `feed_your_posts_${user.identityId}`
        : `feed_${activeTab}`
      
      // Use centralized cache to dedupe and persist the feed
      const sortedPosts = await cacheManager.getOrFetch<any[]>(
        'feed',
        cacheKey,
        async () => {
          // Query posts from the platform
          const queryOptions: any = {
            limit: 20,
            forceRefresh: false
          }
          if (activeTab === 'your-posts' && user?.identityId) {
            queryOptions.authorId = user.identityId
            console.log('Feed: Filtering posts by user:', user.identityId)
          } else {
            console.log('Feed: Loading all posts for:', activeTab)
          }
          const posts = await dashClient.queryPosts(queryOptions)
          // Transform posts to match our UI format
          const transformed = await Promise.all(posts.map(async (doc: any) => {
            const data = doc.data || doc
            const authorIdStr = doc.ownerId || 'unknown'
            return {
              id: doc.id || Math.random().toString(36).substr(2, 9),
              content: data.content || 'No content',
              author: {
                id: authorIdStr,
                username: `user_${authorIdStr.slice(-6)}`,
                handle: `user_${authorIdStr.slice(-6)}`,
                displayName: `User ${authorIdStr.slice(-6)}`,
                verified: false
              },
              createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString(),
              likes: Math.floor(Math.random() * 50),
              replies: Math.floor(Math.random() * 20),
              reposts: Math.floor(Math.random() * 10),
              liked: false,
              reposted: false,
              bookmarked: false
            }
          }))
          // Sort by createdAt newest first
          return transformed.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        },
        { ttl: 30000, tags: ['feed'] }
      )
      
      
      // If no posts found, show helpful message but don't error
      if (sortedPosts.length === 0) {
        console.log('Feed: No posts found on platform')
        setData([])
      } else {
        setData(sortedPosts)
        console.log(`Feed: Successfully loaded ${sortedPosts.length} posts (newest first)`)
      }
      
    } catch (error) {
      console.error('Feed: Failed to load posts from platform:', error)
      
      // Show specific error message but fall back gracefully
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.log('Feed: Falling back to empty state due to error:', errorMessage)
      
      // Set empty data instead of showing error to user
      setData([])
      
      // Only show error to user if it's a critical issue
      if (errorMessage.includes('Contract ID not configured') || 
          errorMessage.includes('Not logged in')) {
        setError(errorMessage)
      }
    } finally {
      setLoading(false)
    }
  }, [postsState.setLoading, postsState.setError, postsState.setData, activeTab, user?.identityId])

  // Load posts on mount, tab change, and listen for new posts
  useEffect(() => {
    loadPosts()
    
    // Listen for new posts created
    const handlePostCreated = () => {
      loadPosts(true) // Force refresh when new post is created
    }
    
    window.addEventListener('post-created', handlePostCreated)
    
    return () => {
      window.removeEventListener('post-created', handlePostCreated)
    }
  }, [loadPosts, activeTab])

  return (
    <div className="min-h-screen flex">
      <Sidebar />
      
      <div className="flex-1 flex justify-center">
        <main className="w-full max-w-[600px] border-x border-gray-200 dark:border-gray-800">
        <header className="sticky top-0 z-40 bg-white/80 dark:bg-black/80 backdrop-blur-xl">
          <div className="px-4 py-3 flex items-center justify-between">
            <h1 className="text-xl font-bold">Home</h1>
            <button
              onClick={() => loadPosts(true)}
              disabled={postsState.loading}
              className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
            >
              <ArrowPathIcon className={`h-5 w-5 text-gray-500 ${postsState.loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          
          <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
            <Tabs.List className="flex border-b border-gray-200 dark:border-gray-800">
              <Tabs.Trigger
                value="for-you"
                className="flex-1 py-4 font-medium text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-950 transition-colors relative data-[state=active]:text-gray-900 dark:data-[state=active]:text-white"
              >
                For You
                {activeTab === 'for-you' && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute bottom-0 left-0 right-0 h-1 bg-yappr-500"
                  />
                )}
              </Tabs.Trigger>
              <Tabs.Trigger
                value="your-posts"
                className="flex-1 py-4 font-medium text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-950 transition-colors relative data-[state=active]:text-gray-900 dark:data-[state=active]:text-white"
              >
                Your Posts
                {activeTab === 'your-posts' && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute bottom-0 left-0 right-0 h-1 bg-yappr-500"
                  />
                )}
              </Tabs.Trigger>
            </Tabs.List>
          </Tabs.Root>
        </header>

        <div className="border-b border-gray-200 dark:border-gray-800 p-4">
          <div className="flex gap-3">
            {activeTab !== 'your-posts' && (
              <div className="h-12 w-12 rounded-full overflow-hidden bg-gray-100">
                {isHydrated ? (
                  avatarFeatures ? (
                    <AvatarCanvas features={avatarFeatures} size={48} />
                  ) : user ? (
                    <Avatar>
                      <AvatarFallback>{user.identityId.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                  ) : (
                    <Avatar>
                      <AvatarFallback>U</AvatarFallback>
                    </Avatar>
                  )
                ) : (
                  <div className="w-full h-full bg-gray-300 dark:bg-gray-700 animate-pulse rounded-full" />
                )}
              </div>
            )}
            <button
              onClick={() => setComposeOpen(true)}
              className="flex-1 text-left px-4 py-3 bg-gray-50 dark:bg-gray-950 rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
            >
              What&apos;s happening?
            </button>
            <button className="p-3 rounded-full hover:bg-yappr-50 dark:hover:bg-yappr-950 text-yappr-500">
              <SparklesIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        <ErrorBoundary level="component">
          <LoadingState
            loading={postsState.loading}
            error={postsState.error}
            isEmpty={!postsState.loading && postsState.data?.length === 0}
            onRetry={loadPosts}
            loadingText="Loading posts..."
            emptyText="No posts yet"
            emptyDescription="Be the first to share something! Note: Dash Platform testnet may be temporarily unavailable."
          >
            <div>
              {postsState.data?.map((post) => (
                <ErrorBoundary key={post.id} level="component">
                  <PostCard 
                    post={post} 
                    hideAvatar={activeTab === 'your-posts'} 
                    isOwnPost={user?.identityId === post.author.id}
                  />
                </ErrorBoundary>
              ))}
            </div>
          </LoadingState>
        </ErrorBoundary>
        </main>
      </div>

      <RightSidebar />
      <ComposeModal />
    </div>
  )
}

export default withAuth(FeedPage, { optional: true })
