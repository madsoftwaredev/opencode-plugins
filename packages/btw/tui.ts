import { Plugin } from "@opencode/plugin/tui"

const BTW_PREFIX = "#BTW "

type ToastVariant = "info" | "success" | "warning" | "error"

export default Plugin.define({
  id: "btw",
  setup(context) {
    const [state, update] = context.storage.store<{ forks: Record<string, string> }>("sessions", {
      initial: { forks: {} },
    })

    const toast = (message: string, variant: ToastVariant = "info", title = "BTW", duration = 5000) => {
      context.ui.toast.show({ title, message, variant, duration })
    }

    const tracked = (sessionID: string) => Object.values(state.forks ?? {}).includes(sessionID)

    const isNotFound = (error: unknown) => {
      const value = error as
        | { status?: number; response?: { status?: number }; message?: string; data?: { message?: string } }
        | undefined
      const status = value?.status ?? value?.response?.status
      const text = `${value?.message ?? ""} ${value?.data?.message ?? ""}`.toLowerCase()
      return status === 404 || text.includes("not found")
    }

    const forkSession = async (parentID: string, title: string) => {
      const response = await context.client.session.fork({ sessionID: parentID })
      const session = (response as { data?: { id?: string }; id?: string }).data ?? response
      const forkedID = (session as { id?: string }).id
      if (!forkedID) throw new Error("fork returned no session id")
      await context.client.session.update({ sessionID: forkedID, title: `${BTW_PREFIX}${title}` }).catch(() => {})
      await update((draft) => {
        draft.forks[parentID] = forkedID
      })
      return forkedID
    }

    context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          mode: "global",
          priority: 10,
          commands: [
            {
              id: "btw.run",
              title: "Run a prompt in a background fork",
              group: "Session",
              palette: true,
              slash: { name: "btw", arguments: true },
              run: async (input) => {
                const text = (input ?? "").trim()
                if (!text) {
                  toast("Usage: /btw <your prompt>", "warning")
                  return
                }
                const route = context.ui.router.current()
                if (route.type !== "session") {
                  toast("Open a session before using /btw", "warning")
                  return
                }
                const parentID = route.sessionID
                const parentTitle = context.data.session.get(parentID)?.title?.trim() || "Untitled"
                const preview = parentTitle.length > 25 ? `${parentTitle.slice(0, 25)}...` : parentTitle

                try {
                  const existing = state.forks?.[parentID]
                  if (existing) {
                    try {
                      await context.client.session.prompt({ sessionID: existing, text })
                      toast(`Forked session started: ${preview}`)
                      return
                    } catch (error) {
                      if (!isNotFound(error)) throw error
                    }
                  }
                  const forkedID = await forkSession(parentID, parentTitle)
                  await context.client.session.prompt({ sessionID: forkedID, text })
                  toast(`Forked session started: ${preview}`)
                } catch (error) {
                  const message = error instanceof Error ? error.message : String(error)
                  if (message.toLowerCase().includes("empty session")) {
                    toast("This session has nothing to fork yet. Send a message first.", "warning")
                    return
                  }
                  toast(message, "error")
                }
              },
            },
          ],
          bindings: ["btw.run"],
        }))
        return null
      },
    })

    const stop = context.data.on("session.idle", (event) => {
      const sessionID = event.data.sessionID
      if (!tracked(sessionID)) return
      let title = context.data.session.get(sessionID)?.title?.trim() || "background task"
      if (title.startsWith(BTW_PREFIX)) title = title.slice(BTW_PREFIX.length)
      const preview = title.length > 25 ? `${title.slice(0, 25)}...` : title
      toast(`${preview} finished.`, "success", "BTW Complete", 8000)
    })

    return () => stop()
  },
})
