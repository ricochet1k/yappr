'use client'

import { useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import { RightSidebar } from '@/components/layout/right-sidebar'
import { ComposeModal } from '@/components/compose/compose-modal'
import { useAppStore } from '@/lib/store'
import { withAuth, useAuth } from '@/contexts/auth-context'
import { LoadingState, useAsyncState } from '@/components/ui/loading-state'
import ErrorBoundary from '@/components/error-boundary'
import { postService } from '@/lib/services'
import { Post as PostView } from '@/components/post/post'

function PostDetailPage() {
  const params = useParams() as { id?: string }
  const postId = params?.id || ''
  const { user } = useAuth()
  const { setReplyingTo, setComposeOpen } = useAppStore()

  const postState = useAsyncState<any | null>(null)
  const repliesState = useAsyncState<any[]>([])

  const load = useCallback(async () => {
    const { setLoading: setPostLoading, setError: setPostError, setData: setPost } = postState
    const { setLoading: setRepliesLoading, setError: setRepliesError, setData: setReplies } = repliesState
    setPostLoading(true)
    setRepliesLoading(true)
    setPostError(null)
    setRepliesError(null)
    try {
      const main = await postService.get(postId)
      setPost(main)
    } catch (e: any) {
      setPost(null)
      setPostError(e?.message || 'Failed to load post')
    } finally {
      setPostLoading(false)
    }
    try {
      const res = await postService.getReplies(postId, { limit: 100 })
      setReplies(res.documents)
    } catch (e: any) {
      setReplies([])
      setRepliesError(e?.message || 'Failed to load replies')
    } finally {
      setRepliesLoading(false)
    }
  }, [postId, postState, repliesState])

  useEffect(() => {
    if (!postId) return
    load()
    const onUpdated = (e: any) => {
      if (e?.detail?.postId === postId) {
        load()
      }
    }
    const onCreated = () => load()
    window.addEventListener('post-updated', onUpdated as any)
    window.addEventListener('post-created', onCreated as any)
    return () => {
      window.removeEventListener('post-updated', onUpdated as any)
      window.removeEventListener('post-created', onCreated as any)
    }
  }, [postId, load])

  const openReply = () => {
    if (postState.data) {
      setReplyingTo(postState.data)
      setComposeOpen(true)
    }
  }

  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <div className="flex-1 flex justify-center">
        <main className="w-full max-w-[600px] border-x border-gray-200 dark:border-gray-800">
          <header className="sticky top-0 z-40 bg-white/80 dark:bg-black/80 backdrop-blur-xl">
            <div className="px-4 py-3 flex items-center justify-between">
              <h1 className="text-xl font-bold">Post</h1>
              <button
                onClick={() => load()}
                disabled={postState.loading || repliesState.loading}
                className="text-sm text-yappr-500"
              >
                Refresh
              </button>
            </div>
          </header>

          <ErrorBoundary level="component">
            <LoadingState
              loading={postState.loading}
              error={postState.error}
              isEmpty={!postState.loading && !postState.data}
              onRetry={load}
              loadingText="Loading post..."
              emptyText="Post not found"
            >
              {postState.data && (
                <PostView post={postState.data} currentUserId={user?.identityId || null} />
              )}
              <div className="px-4 py-3">
                <button
                  onClick={openReply}
                  className="px-4 py-2 rounded-full bg-yappr-500 text-white text-sm hover:bg-yappr-600"
                >
                  Reply
                </button>
              </div>
            </LoadingState>
          </ErrorBoundary>

          <ErrorBoundary level="component">
            <LoadingState
              loading={repliesState.loading}
              error={repliesState.error}
              isEmpty={!repliesState.loading && (repliesState.data?.length || 0) === 0}
              onRetry={load}
              loadingText="Loading replies..."
              emptyText="No replies yet"
            >
              <div>
                {(repliesState.data || []).map((reply: any) => (
                  <ErrorBoundary key={reply.id} level="component">
                    <PostView post={reply} currentUserId={user?.identityId || null} />
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

export default withAuth(PostDetailPage, { optional: true })
