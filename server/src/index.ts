import { createApp } from './create_app.js'

const { app, config } = createApp()

app.listen(config.port, () => {
  console.log(`Lucifer listening on port ${config.port}`)
})
