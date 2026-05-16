export const OPENVIKING_BLOG = {
  sourceUrl: 'https://www.openviking.ai/blog/introducing-openviking',
  logoUrl: 'https://res.gcloudcache.com/bp-fe/openviking/playground/static/image/openviking-logo-CNg0ex3-.png',
  heroImageUrl: 'https://res.gcloudcache.com/bp-fe/openviking/playground/static/image/Agent-OxjzjhFK.png',
  tag: 'announcement',
  title: 'OpenViking: Context Database for AI Agents',
  date: 'January 30, 2026',
  subtitle: 'Break Free from Context Chaos: The Open-Source Context Database for AI Agents',
  quote: '"We are swimming in a sea of information, and we need to learn to navigate." - Norbert Wiener',
  body: [
    {
      type: 'paragraph',
      text: 'The era of AI Agents is here. They are evolving from simple task executors into intelligent entities that can perceive their environment, devise plans, and leverage tools to achieve complex goals. But in this sea of opportunity, developers are hitting a formidable iceberg: context management.',
    },
    {
      type: 'paragraph',
      text: 'As models grow more powerful, Agents are no longer limited to single-turn conversations or short texts. They now tackle long-running tasks, vast multimodal data, and complex collaborative workflows. The context they rely on - memory, resources, abilities - is scattered, making it increasingly chaotic to manage. This has become a universal bottleneck for developers, manifesting in several key challenges:',
    },
    {
      type: 'list',
      items: [
        'Disordered and Fragmented Context: Memories live in code, resources are in a vector database, and abilities are strewn across different modules. Connecting and maintaining them is a high-cost nightmare.',
        'Intensive Context Demands for Long-Term Tasks: Agents are shifting from single-turn chats to long-cycle missions involving multiple tools and inter-agent collaboration. Each execution step pressures the context window and the model\'s comprehension. Naive truncation or compression is a "pawn sacrifice" strategy, leading to irreversible information loss and soaring model costs.',
        'Limitations of Basic RAG: Simple RAG uses a flat data-slicing approach, lacking a global perspective. It struggles with massive, multimodal, and structured data, often missing critical information. Its over-reliance on semantic relevance also falls short in open-ended scenarios that require exploration and interest generalization.',
        'Lack of Observability and Debugging: The popularity of projects like DeepSeek and Manus reveals a growing user desire for white-box experiences that show an AI\'s thinking and decision-making process. The opaque retrieval pipelines of traditional RAG are like black boxes, making it difficult to attribute and debug errors, thus raising the bar for improvement.',
        'Memory as a Core Asset: With models becoming a commodity, developers increasingly recognize that accumulated memory is an Agent\'s true core asset. This includes not just the user\'s memory, but the Agent\'s own experiences and preferences. Memory infrastructure must be established from day one to create a compounding effect, where the Agent gets better the more it\'s used.',
      ],
    },
    {
      type: 'paragraph',
      text: 'Recent explorations in Context Engineering offer valuable insights. Manus proposed the file system as the ultimate form of context. The success of Claude Code demonstrated that a simple file system + Bash approach can outperform complex vector indexes in specific scenarios. And Anthropic\'s Skills system cleverly organizes capabilities into folders. These practices are inspiring, but they also highlight a gap: while the file system is an excellent organizational paradigm, no database-like solution existed to effectively manage all the context an Agent needs and solve the problems above.',
    },
    {
      type: 'paragraph',
      text: 'Today, we are thrilled to officially open-source OpenViking - a context database designed from the ground up for AI Agents.',
    },
    {
      type: 'paragraph',
      text: 'We aim to define a minimalist interaction paradigm for Agent context, letting developers say goodbye to management headaches. OpenViking moves beyond the fragmented vector storage of traditional RAG by adopting an innovative "File System Paradigm," unifying the organization of Memory, Resources, and Abilities.',
    },
    {
      type: 'paragraph',
      text: 'With OpenViking, you can build your Agent\'s brain as easily as managing local files:',
    },
    {
      type: 'list',
      items: [
        'File System Paradigm -> Solves Fragmentation. Manage Memory, Resources, and Skills in a unified, structured directory tree, breaking down data silos.',
        'Layered & On-Demand Context -> Lowers Token Costs. Utilizes an L0/L1/L2 layered structure. Agents load lightweight indices for planning and fetch details only when needed, drastically reducing costs and latency.',
        'Recursive Directory Retrieval -> Improves Precision. Combines directory navigation with semantic search. Achieves precise context acquisition through recursive lookups, solving the accuracy issues of traditional RAG.',
        'Visualized Retrieval Tracing -> Ensures Observability. Provides a visualized trace of the directory retrieval process. Clearly observe the Agent\'s "thought path" to debug root causes and optimize retrieval logic.',
        'Automated Session Management -> Enables Self-Iteration. Automatically compresses conversation content, resource citations, and tool usage to extract long-term memories, making your Agent smarter with every interaction.',
      ],
    },
    {
      type: 'paragraph',
      text: 'Join us as we dive deeper into OpenViking and see how it helps you break free from the shackles of context and set sail on the AI Agent wave.',
    },
    {
      type: 'heading',
      text: 'The Core Philosophy of OpenViking',
    },
    {
      type: 'paragraph',
      text: 'To address the challenges of context management, OpenViking is built on four core principles. These are designed to simplify complexity and empower developers to focus on what truly matters: innovation.',
    },
    {
      type: 'subheading',
      text: 'Context Organization as a File System',
    },
    {
      type: 'paragraph',
      text: 'We no longer treat context as flat text chunks. Instead, we abstract and organize it within a virtual file system. Every piece of context - be it a memory, a resource, or an skill - is mapped to a virtual directory under the viking:// protocol, each with a unique URI. This paradigm gives agents unprecedented control over their context. They can use standard commands like list and find to precisely and deterministically locate, browse, and manipulate information.',
    },
    {
      type: 'subheading',
      text: 'Layered Context Loading',
    },
    {
      type: 'paragraph',
      text: 'Dumping massive amounts of context into a prompt is not only expensive but also risks exceeding the model\'s window and introducing noise. Drawing from cutting-edge industry practices, OpenViking automatically processes context into three layers upon ingestion:',
    },
    {
      type: 'list',
      items: [
        'L0 (Abstract): A single-sentence summary for quick identification.',
        'L1 (Overview): Contains core information and usage scenarios, allowing the Agent to make decisions during the planning phase.',
        'L2 (Details): The complete, raw data for the Agent to read in-depth when necessary.',
      ],
    },
    {
      type: 'paragraph',
      text: 'This design makes OpenViking highly adaptable to a wide range of AI Agent development scenarios. Whether you\'re building a simple Q&A bot or a complex automated workflow, it provides a robust and efficient context foundation.',
    },
    {
      type: 'subheading',
      text: 'Recursive Context Retrieval',
    },
    {
      type: 'paragraph',
      text: 'A single vector search is often insufficient for complex query intents. OpenViking introduces an innovative Recursive Context Retrieval strategy that combines the strengths of multiple retrieval methods.',
    },
    {
      type: 'paragraph',
      text: 'The process is as follows: first, it analyzes the intent to generate multiple retrieval conditions; then, it uses vector search to quickly locate the high-score directories containing the initial chunks; next, it performs a secondary search within those directories and adds the top results to the candidate set; if subdirectories exist, it recursively repeats the secondary search process layer by layer. Finally, it returns the most relevant context.',
    },
    {
      type: 'subheading',
      text: 'Observable and Self-Evolving Context',
    },
    {
      type: 'paragraph',
      text: 'OpenViking\'s hierarchical virtual file system breaks away from the traditional flat, black-box management model. All context is integrated in a unified format, with each entry corresponding to a unique URI, making it clear and easy to understand. The directory-recursive retrieval process leaves a complete trace of every directory browsed and file located.',
    },
    {
      type: 'paragraph',
      text: 'Furthermore, OpenViking features a built-in self-iteration loop for memory. At the end of each session, a call to session.commit() triggers an asynchronous process. The system analyzes the task outcome and user feedback, then automatically updates the /memory directories for both the User and the Agent.',
    },
  ],
};
