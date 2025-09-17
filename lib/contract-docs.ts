import { DataContract } from './contract-api'
import {
  Like,
  List,
  Mute,
  Post,
  Block,
  Avatar,
  Follow,
  Repost,
  Profile,
  Bookmark,
  ListMember,
  Notification,
  DirectMessage,
} from './contract-types.generated'
import { YAPPR_CONTRACT_ID } from './constants'

export const dataContract = new DataContract(YAPPR_CONTRACT_ID)

export const likes = new Like(dataContract)
export const lists = new List(dataContract)
export const mutes = new Mute(dataContract)
export const posts = new Post(dataContract)
export const blocks = new Block(dataContract)
export const avatars = new Avatar(dataContract)
export const follows = new Follow(dataContract)
export const reposts = new Repost(dataContract)
export const profiles = new Profile(dataContract)
export const bookmarks = new Bookmark(dataContract)
export const listMembers = new ListMember(dataContract)
export const notifications = new Notification(dataContract)
export const directMessages = new DirectMessage(dataContract)

