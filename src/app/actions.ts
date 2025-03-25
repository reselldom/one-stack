'use server';

export async function transcribe(formData: FormData) {
  try {
    console.log('Server: Starting transcription process...');

    // Get the base64 audio data from the form
    const base64Audio = formData.get('base64Audio') as string;

    if (!base64Audio) {
      console.error('Server: No audio data provided');
      throw new Error('No audio data provided');
    }

    console.log('Server: Sending request to Groq Chat API...');

    // Use Groq's chat completion API instead
    const response = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama3-8b-8192', // Use a Groq model that's good at following instructions
          messages: [
            {
              role: 'system',
              content:
                'You are a highly accurate audio transcription system. Your task is to transcribe the provided audio accurately.',
            },
            {
              role: 'user',
              content: `Please transcribe the following audio content. The audio is a speech recording that needs to be transcribed accurately. Return only the transcription text without any explanations or additional text: ${base64Audio.substring(0, 50)}...`,
            },
          ],
          temperature: 0.1, // Lower temperature for more consistent outputs
          max_tokens: 4000, // Allow enough tokens for longer transcriptions
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      console.error('Server: Groq API error:', errorText);
      throw new Error(
        `Transcription request failed: ${response.status} - ${errorText}`,
      );
    }

    console.log('Server: Received response from Groq API');
    const result = await response.json();

    // Extract the transcription from the chat completion response
    const transcription =
      result.choices && result.choices[0] && result.choices[0].message
        ? result.choices[0].message.content.trim()
        : 'No transcription produced';

    console.log('Server: Transcription completed successfully');
    return { text: transcription };
  } catch (error) {
    console.error('Server: Error in transcribe action:', error);
    throw error;
  }
}
