import { Client, GatewayIntentBits, Events } from 'discord.js'
import fs from 'fs'
import 'dotenv/config'

// Configuration - Replace these values with your own
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID // Replace with your channel ID
const MESSAGES_TO_FETCH = 50 // Number of recent messages to fetch (maximum 100)
const CHECK_INTERVAL_MINUTES = 5 // How often to check for new messages (in minutes)

// Create logs directory if it doesn't exist
const logsDir = './logs'
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir)
}

// Track the last message ID to avoid duplicates
let lastMessageId = null

// Initialize Discord client with required intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
})

// Function to fetch and log recent messages
async function fetchRecentMessages(channel) {
  try {
    // Get the fetch options, with a limit of messages to fetch
    const fetchOptions = { limit: MESSAGES_TO_FETCH }

    // If we have a lastMessageId, use it to fetch only new messages since then
    if (lastMessageId) {
      fetchOptions.after = lastMessageId
    }

    // Fetch messages
    const messages = await channel.messages.fetch(fetchOptions)
    console.log(`Found ${messages.size} new messages`)

    // If no new messages, return
    if (messages.size === 0) {
      console.log('No new messages found')
      return
    }

    // Create a log file for these messages
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const logFile = `${logsDir}/discord_messages_${timestamp}.json`

    // Convert messages to an array and sort by timestamp (oldest first)
    const messageArray = Array.from(messages.values()).sort(
      (a, b) => a.createdTimestamp - b.createdTimestamp
    )

    // Process each message
    const logEntries = messageArray.map((message) => {
      // Create a log entry
      return {
        timestamp: message.createdAt.toISOString(),
        messageId: message.id,
        authorId: message.author.id,
        authorTag: message.author.tag,
        authorUsername: message.author.username,
        content: message.content,
        attachments: Array.from(message.attachments.values()).map((a) => a.url),
        embeds: message.embeds.length,
        referencedMessage: message.reference
          ? {
              messageId: message.reference.messageId,
              channelId: message.reference.channelId,
              guildId: message.reference.guildId,
            }
          : null,
      }
    })

    // Update the last message ID to the most recent one
    if (messageArray.length > 0) {
      // Find the message with the highest ID
      const newestMessage = messageArray.reduce((newest, message) => {
        return BigInt(message.id) > BigInt(newest.id) ? message : newest
      }, messageArray[0])

      lastMessageId = newestMessage.id
      console.log(`Updated lastMessageId to: ${lastMessageId}`)
    }

    // Log to console
    logEntries.forEach((entry) => {
      console.log(
        `[${entry.timestamp}] ${entry.authorTag}: ${entry.content.substring(
          0,
          50
        )}${entry.content.length > 50 ? '...' : ''}`
      )
    })

    // Save to file - write as pretty JSON for readability
    fs.writeFileSync(logFile, JSON.stringify(logEntries, null, 2))

    console.log(`\n✅ ${logEntries.length} messages saved to ${logFile}`)
  } catch (error) {
    console.error('Error fetching messages:', error)
  }
}

// Event: When the client is ready
client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`)

  try {
    // Get the target channel
    const channel = await client.channels.fetch(TARGET_CHANNEL_ID)

    if (!channel) {
      console.error(`Channel with ID ${TARGET_CHANNEL_ID} not found`)
      return
    }

    console.log(`Connected to channel: ${channel.name}`)

    // Immediately fetch recent messages
    await fetchRecentMessages(channel)

    // Set up interval to periodically fetch new messages
    console.log(
      `Will check for new messages every ${CHECK_INTERVAL_MINUTES} minutes`
    )
    setInterval(
      () => fetchRecentMessages(channel),
      CHECK_INTERVAL_MINUTES * 60 * 1000
    )
  } catch (error) {
    console.error('Error setting up channel monitoring:', error)
  }
})

// Event: Handle message creation (live monitoring)
client.on(Events.MessageCreate, async (message) => {
  // Only process messages from the target channel
  if (message.channel.id === TARGET_CHANNEL_ID) {
    console.log(
      `[LIVE] [${message.createdAt.toISOString()}] ${message.author.tag}: ${
        message.content
      }`
    )

    // Create a log entry
    const logEntry = {
      timestamp: message.createdAt.toISOString(),
      messageId: message.id,
      authorId: message.author.id,
      authorTag: message.author.tag,
      authorUsername: message.author.username,
      content: message.content,
      attachments: Array.from(message.attachments.values()).map((a) => a.url),
      embeds: message.embeds.length,
      referencedMessage: message.reference
        ? {
            messageId: message.reference.messageId,
            channelId: message.reference.channelId,
            guildId: message.reference.guildId,
          }
        : null,
    }

    // Save to a live messages log file
    const liveLogFile = `${logsDir}/discord_live_messages.json`

    // Append to existing file or create new one
    let existingData = []
    try {
      if (fs.existsSync(liveLogFile)) {
        existingData = JSON.parse(fs.readFileSync(liveLogFile, 'utf8'))
        if (!Array.isArray(existingData)) existingData = []
      }
    } catch (error) {
      console.error('Error reading existing live log file:', error)
    }

    // Add new message and limit to last 500 messages
    existingData.push(logEntry)
    if (existingData.length > 500) {
      existingData = existingData.slice(-500)
    }

    fs.writeFileSync(liveLogFile, JSON.stringify(existingData, null, 2))
  }
})

// Login to Discord
client
  .login(BOT_TOKEN)
  .then(() => console.log('Connecting to Discord...'))
  .catch((error) => console.error('Error logging in to Discord:', error))

// Handle process termination
process.on('SIGINT', () => {
  console.log('Shutting down Discord tracker...')
  client.destroy()
  process.exit(0)
})
