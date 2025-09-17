
import contract from '@/contracts/yappr-social-contract'

type Contract = typeof contract
type DocumentTypes = keyof Contract

type Postraw = Contract['post']



type PropsOf<D> = {[k in keyof D]: D[k]}

type foo = PropsOf<Postraw['properties']>;