'use client'

import { useState } from 'react'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { 
  ChatBubbleOvalLeftIcon, 
  ArrowPathIcon, 
  HeartIcon, 
  ArrowUpTrayIcon,
  BookmarkIcon,
  EllipsisHorizontalIcon,
} from '@heroicons/react/24/outline'
import { HeartIcon as HeartIconSolid, BookmarkIcon as BookmarkIconSolid } from '@heroicons/react/24/solid'
import { Post } from '@/lib/types'
import { formatTime, formatNumber } from '@/lib/utils'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { IconButton } from '@/components/ui/icon-button'
import { getInitials, cn } from '@/lib/utils'
import { useAppStore } from '@/lib/store'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Tooltip from '@radix-ui/react-tooltip'
import toast from 'react-hot-toast'
import { AvatarCanvas } from '@/components/ui/avatar-canvas'
import { decodeAvatarFeaturesV2, generateAvatarV2 } from '@/lib/avatar-generator-v2'
import { LikesModal } from './likes-modal'
import { AuthorDisplay } from '@/components/author/author-display'

interface PostCardProps {
  post: Post
  hideAvatar?: boolean
  isOwnPost?: boolean
}

export function PostCard({ post, hideAvatar = false, isOwnPost = false }: PostCardProps) {
  const [liked, setLiked] = useState(post.liked || false)
  const [likes, setLikes] = useState(post.likes)
  const [reposted, setReposted] = useState(post.reposted || false)
  const [reposts, setReposts] = useState(post.reposts)
  const [bookmarked, setBookmarked] = useState(post.bookmarked || false)
  const [showLikesModal, setShowLikesModal] = useState(false)
  const { setReplyingTo, setComposeOpen } = useAppStore()
  
  const avatarFeatures = post.author.avatarData 
    ? decodeAvatarFeaturesV2(post.author.avatarData)
    : generateAvatarV2(post.author.username)

  const handleLike = () => {
    if (hideAvatar) {
      // On "Your Posts" tab, show who liked instead of liking
      setShowLikesModal(true)
    } else {
      // Normal like behavior
      setLiked(!liked)
      setLikes(liked ? likes - 1 : likes + 1)
    }
  }

  const handleRepost = () => {
    setReposted(!reposted)
    setReposts(reposted ? reposts - 1 : reposts + 1)
    toast.success(reposted ? 'Removed repost' : 'Reposted!')
  }

  const handleBookmark = () => {
    setBookmarked(!bookmarked)
    toast.success(bookmarked ? 'Removed from bookmarks' : 'Added to bookmarks')
  }

  const handleReply = () => {
    setReplyingTo(post)
    setComposeOpen(true)
  }

  const handleShare = () => {
    navigator.clipboard.writeText(`https://yappr.app/posts/${post.id}`)
    toast.success('Link copied to clipboard')
  }

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="border-b border-gray-200 dark:border-gray-800 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-950 transition-colors cursor-pointer"
    >
      <div className="flex gap-3">
        {!hideAvatar && (
          <div className="h-12 w-12 rounded-full overflow-hidden bg-gray-100">
            {isOwnPost ? (
              <Image 
                src="/yappr.png" 
                alt="Yappr" 
                width={48} 
                height={48} 
                className="w-full h-full object-cover"
              />
            ) : (
              <AvatarCanvas features={avatarFeatures} size={48} />
            )}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 text-sm">
              {isOwnPost ? (
                <span className="text-gray-500">You wrote {formatTime(post.createdAt)}:</span>
              ) : (
                <>
                  {!hideAvatar && (
                    <AuthorDisplay author={post.author} createdAt={post.createdAt} />
                  )}
                </>
              )}
            </div>

            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <IconButton>
                  <EllipsisHorizontalIcon className="h-5 w-5" />
                </IconButton>
              </DropdownMenu.Trigger>
              
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="min-w-[200px] bg-white dark:bg-black rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 py-2 z-50"
                  sideOffset={5}
                >
                  <DropdownMenu.Item className="px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-900 cursor-pointer outline-none">
                    Follow @{post.author.username}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className="px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-900 cursor-pointer outline-none">
                    Add to Lists
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className="px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-900 cursor-pointer outline-none">
                    Mute @{post.author.username}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className="px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-900 cursor-pointer outline-none text-red-500">
                    Block @{post.author.username}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>

          <div className="mt-1 whitespace-pre-wrap break-words">{post.content}</div>

          {post.quotedPost && (
            <div className="mt-3 border border-gray-200 dark:border-gray-800 rounded-xl p-3 hover:bg-gray-50 dark:hover:bg-gray-950 transition-colors">
              <div className="flex items-center gap-1 text-sm text-gray-500">
                <Avatar className="h-5 w-5">
                  <AvatarImage src={post.quotedPost.author.avatar} />
                  <AvatarFallback>{getInitials(post.quotedPost.author.displayName)}</AvatarFallback>
                </Avatar>
                <AuthorDisplay author={post.quotedPost.author} createdAt={post.quotedPost.createdAt} />
              </div>
              <div className="mt-1 text-sm">{post.quotedPost.content}</div>
            </div>
          )}

          {post.media && post.media.length > 0 && (
            <div className={cn(
              'mt-3 grid gap-1 rounded-xl overflow-hidden',
              post.media.length === 1 && 'grid-cols-1',
              post.media.length === 2 && 'grid-cols-2',
              post.media.length === 3 && 'grid-cols-2',
              post.media.length >= 4 && 'grid-cols-2'
            )}>
              {post.media.map((media, index) => (
                <div
                  key={media.id}
                  className={cn(
                    'relative aspect-video bg-gray-100 dark:bg-gray-900',
                    post.media!.length === 3 && index === 0 && 'row-span-2'
                  )}
                >
                  <Image
                    src={media.url}
                    alt={media.alt || ''}
                    fill
                    className="object-cover"
                  />
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between mt-3 -ml-2">
            <Tooltip.Provider>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    onClick={handleReply}
                    className="group flex items-center gap-1 p-2 rounded-full hover:bg-yappr-50 dark:hover:bg-yappr-950 transition-colors"
                  >
                    <ChatBubbleOvalLeftIcon className="h-5 w-5 text-gray-500 group-hover:text-yappr-500 transition-colors" />
                    <span className="text-sm text-gray-500 group-hover:text-yappr-500 transition-colors">
                      {post.replies > 0 && formatNumber(post.replies)}
                    </span>
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    className="bg-gray-800 dark:bg-gray-700 text-white text-xs px-2 py-1 rounded"
                    sideOffset={5}
                  >
                    Reply
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>

              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    onClick={handleRepost}
                    className={cn(
                      'group flex items-center gap-1 p-2 rounded-full transition-colors',
                      reposted
                        ? 'text-green-500 hover:bg-green-50 dark:hover:bg-green-950'
                        : 'hover:bg-green-50 dark:hover:bg-green-950'
                    )}
                  >
                    <ArrowPathIcon className={cn(
                      'h-5 w-5 transition-colors',
                      reposted ? 'text-green-500' : 'text-gray-500 group-hover:text-green-500'
                    )} />
                    <span className={cn(
                      'text-sm transition-colors',
                      reposted ? 'text-green-500' : 'text-gray-500 group-hover:text-green-500'
                    )}>
                      {reposts > 0 && formatNumber(reposts)}
                    </span>
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    className="bg-gray-800 dark:bg-gray-700 text-white text-xs px-2 py-1 rounded"
                    sideOffset={5}
                  >
                    Repost
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>

              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    onClick={handleLike}
                    className={cn(
                      'group flex items-center gap-1 p-2 rounded-full transition-colors',
                      liked
                        ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-950'
                        : 'hover:bg-red-50 dark:hover:bg-red-950'
                    )}
                  >
                    <motion.div
                      whileTap={{ scale: 0.8 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                    >
                      {liked ? (
                        <HeartIconSolid className="h-5 w-5 text-red-500" />
                      ) : (
                        <HeartIcon className="h-5 w-5 text-gray-500 group-hover:text-red-500 transition-colors" />
                      )}
                    </motion.div>
                    <span className={cn(
                      'text-sm transition-colors',
                      liked ? 'text-red-500' : 'text-gray-500 group-hover:text-red-500'
                    )}>
                      {likes > 0 && formatNumber(likes)}
                    </span>
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    className="bg-gray-800 dark:bg-gray-700 text-white text-xs px-2 py-1 rounded"
                    sideOffset={5}
                  >
                    Like
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>


              <div className="flex items-center gap-1">
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      onClick={handleBookmark}
                      className="p-2 rounded-full hover:bg-yappr-50 dark:hover:bg-yappr-950 transition-colors"
                    >
                      {bookmarked ? (
                        <BookmarkIconSolid className="h-5 w-5 text-yappr-500" />
                      ) : (
                        <BookmarkIcon className="h-5 w-5 text-gray-500 hover:text-yappr-500 transition-colors" />
                      )}
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      className="bg-gray-800 dark:bg-gray-700 text-white text-xs px-2 py-1 rounded"
                      sideOffset={5}
                    >
                      Bookmark
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>

                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      onClick={handleShare}
                      className="p-2 rounded-full hover:bg-yappr-50 dark:hover:bg-yappr-950 transition-colors"
                    >
                      <ArrowUpTrayIcon className="h-5 w-5 text-gray-500 hover:text-yappr-500 transition-colors" />
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      className="bg-gray-800 dark:bg-gray-700 text-white text-xs px-2 py-1 rounded"
                      sideOffset={5}
                    >
                      Share
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </div>
            </Tooltip.Provider>
          </div>
        </div>
      </div>
      
      <LikesModal 
        isOpen={showLikesModal}
        onClose={() => setShowLikesModal(false)}
        postId={post.id}
      />
    </motion.article>
  )
}
